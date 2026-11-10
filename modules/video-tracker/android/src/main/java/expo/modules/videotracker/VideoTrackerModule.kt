package expo.modules.videotracker

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

class TrackOptions : Record {
  @Field var startMs: Double = 0.0
  @Field var endMs: Double = 0.0
  @Field var stepMs: Double = 66.0     // 프레임 간격(ms). 66 ≈ 초당 15장
  @Field var xs: List<Double> = listOf(0.5) // 시작 프레임에서 찍은 점들(1~2개). 0~1, 영상 가로 비율
  @Field var ys: List<Double> = listOf(0.5) // 0~1, 영상 세로 비율
  @Field var maxSide: Int = 320        // 추적용으로 줄인 프레임의 긴 변(px)
  @Field var radius: Int = 8           // 템플릿 반지름(줄인 프레임 기준 px)
  @Field var search: Int = 18          // 프레임마다 찾아볼 범위 반지름(px)
  @Field var minScore: Double = 0.6    // 이보다 덜 비슷하면 놓친 것으로 본다
  @Field var refreshScore: Double = 0.85
  @Field var jobId: String = ""
}

/**
 * 사용자가 찍은 "한 점"만 영상 구간에서 따라간다. 사람 전체를 분석하지 않는다.
 * 구간의 프레임을 작게 줄여(긴 변 320px) 흑백으로 바꾸고, 점 주변 조각(템플릿)과 가장 닮은 곳을 근처에서 찾는다.
 * 같은 알고리즘의 기준 구현은 src/domain/pointTrack.ts (테스트 대상).
 */
class VideoTrackerModule : Module() {
  private val cancels = ConcurrentHashMap<String, AtomicBoolean>()

  private fun ctx(): Context =
    appContext.reactContext ?: throw CodedException("NO_CONTEXT", "앱 컨텍스트를 찾을 수 없습니다", null)

  private fun open(uri: String): MediaMetadataRetriever {
    val r = MediaMetadataRetriever()
    try {
      val u = Uri.parse(uri)
      if (u.scheme == null || u.scheme == "file") r.setDataSource(u.path ?: uri) else r.setDataSource(ctx(), u)
    } catch (e: Exception) {
      r.release()
      throw CodedException("OPEN_FAILED", "영상을 열 수 없습니다: ${e.message}", e)
    }
    return r
  }

  private fun dims(r: MediaMetadataRetriever): IntArray {
    var w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
    var h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
    val rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
    if (rot == 90 || rot == 270) { val t = w; w = h; h = t }
    return intArrayOf(w, h, rot)
  }

  override fun definition() = ModuleDefinition {
    Name("VideoTracker")
    Events("onProgress")

    AsyncFunction("getVideoInfo") { uri: String ->
      val r = open(uri)
      try {
        val dur = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
        val d = dims(r)
        mapOf("durationMs" to dur.toDouble(), "width" to d[0], "height" to d[1], "rotation" to d[2])
      } finally {
        r.release()
      }
    }

    Function("cancel") { jobId: String -> cancels[jobId]?.set(true) }

    AsyncFunction("track") { uri: String, o: TrackOptions ->
      val cancel = AtomicBoolean(false)
      cancels[o.jobId] = cancel
      try {
        runTrack(uri, o, cancel)
      } finally {
        cancels.remove(o.jobId)
      }
    }
  }

  private class PointState(var cx: Double, var cy: Double, n: Int) {
    var tpl: FloatArray? = null
    var lost = false
    var lostAt = -1.0
    val xs = DoubleArray(n) { -1.0 }
    val ys = DoubleArray(n) { -1.0 }
    val scores = DoubleArray(n)
  }

  /** 결과: { times:[ms...], frameW, frameH, tracks:[{ xs:[0~1 또는 -1(놓침)], ys, scores, lostAtMs(-1이면 안 놓침) }...] } */
  private fun runTrack(uri: String, o: TrackOptions, cancel: AtomicBoolean): Map<String, Any> {
    val stepMs = if (o.stepMs < 16) 16.0 else o.stepMs
    val total = Math.floor((o.endMs - o.startMs) / stepMs).toInt() + 1
    if (total <= 0) throw CodedException("BAD_RANGE", "구간이 올바르지 않습니다", null)
    val count = Math.min(o.xs.size, o.ys.size)
    if (count < 1 || count > 4) throw CodedException("BAD_POINTS", "추적할 점이 올바르지 않습니다", null)
    val r = open(uri)
    try {
      val d = dims(r)
      if (d[0] <= 0 || d[1] <= 0) throw CodedException("OPEN_FAILED", "영상 크기를 읽을 수 없습니다", null)
      val scale = Math.min(1.0, o.maxSide.toDouble() / Math.max(d[0], d[1]))
      val fw = Math.max(16, Math.round(d[0] * scale).toInt())
      val fh = Math.max(16, Math.round(d[1] * scale).toInt())

      val times = DoubleArray(total)
      val pts = List(count) { PointState(o.xs[it] * fw, o.ys[it] * fh, total) }
      val rad = o.radius
      val pix = IntArray(fw * fh)
      val gray = FloatArray(fw * fh)
      var lastEmit = 0L

      for (i in 0 until total) {
        if (cancel.get()) throw CodedException("CANCELLED", "취소했습니다", null)
        val tMs = o.startMs + i * stepMs
        times[i] = tMs
        if (pts.all { it.lost }) continue
        val bmp = frameAt(r, tMs, fw, fh)
        if (bmp == null) {
          for (p in pts) if (!p.lost) { p.lost = true; p.lostAt = tMs }
          continue
        }
        toGray(bmp, fw, fh, pix, gray)
        bmp.recycle()
        for (p in pts) {
          if (p.lost) continue
          val t0 = p.tpl
          if (t0 == null) {
            p.tpl = patch(gray, fw, fh, Math.round(p.cx).toInt(), Math.round(p.cy).toInt(), rad)
            p.xs[i] = p.cx / fw; p.ys[i] = p.cy / fh; p.scores[i] = 1.0
          } else {
            val res = matchStep(t0, gray, fw, fh, p.cx, p.cy, rad, o.search)
            if (res[2] < o.minScore) {
              p.lost = true; p.lostAt = tMs
            } else {
              p.cx = res[0]; p.cy = res[1]
              p.xs[i] = p.cx / fw; p.ys[i] = p.cy / fh; p.scores[i] = res[2]
              if (res[2] >= o.refreshScore) p.tpl = patch(gray, fw, fh, Math.round(p.cx).toInt(), Math.round(p.cy).toInt(), rad)
            }
          }
        }
        val now = System.currentTimeMillis()
        if (now - lastEmit > 120 || i == total - 1) {
          lastEmit = now
          sendEvent("onProgress", mapOf("jobId" to o.jobId, "done" to (i + 1), "total" to total))
        }
      }
      return mapOf(
        "times" to times.toList(), "frameW" to fw, "frameH" to fh,
        "tracks" to pts.map { mapOf("xs" to it.xs.toList(), "ys" to it.ys.toList(), "scores" to it.scores.toList(), "lostAtMs" to it.lostAt) },
      )
    } finally {
      r.release()
    }
  }

  private fun frameAt(r: MediaMetadataRetriever, tMs: Double, w: Int, h: Int): Bitmap? {
    val us = (tMs * 1000).toLong()
    return try {
      if (Build.VERSION.SDK_INT >= 27) {
        r.getScaledFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST, w, h)
      } else {
        val f = r.getFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST) ?: return null
        val s = Bitmap.createScaledBitmap(f, w, h, true)
        if (s !== f) f.recycle()
        s
      }
    } catch (e: Exception) {
      null
    }
  }

  private fun toGray(b: Bitmap, w: Int, h: Int, pix: IntArray, out: FloatArray) {
    val bm = if (b.width != w || b.height != h) Bitmap.createScaledBitmap(b, w, h, true) else b
    bm.getPixels(pix, 0, w, 0, 0, w, h)
    if (bm !== b) bm.recycle()
    for (i in pix.indices) {
      val p = pix[i]
      out[i] = (0.299f * ((p shr 16) and 0xff) + 0.587f * ((p shr 8) and 0xff) + 0.114f * (p and 0xff))
    }
  }

  private fun patch(g: FloatArray, w: Int, h: Int, cx: Int, cy: Int, r: Int): FloatArray {
    val n = 2 * r + 1
    val out = FloatArray(n * n)
    var k = 0
    for (dy in -r..r) {
      val yy = (cy + dy).coerceIn(0, h - 1)
      for (dx in -r..r) out[k++] = g[yy * w + (cx + dx).coerceIn(0, w - 1)]
    }
    return out
  }

  /** 반환: [x, y, 점수(ZNCC)] */
  private fun matchStep(tpl: FloatArray, g: FloatArray, w: Int, h: Int, px: Double, py: Double, r: Int, search: Int): DoubleArray {
    val n = 2 * r + 1
    val cnt = n * n
    var mt = 0.0
    for (v in tpl) mt += v
    mt /= cnt
    var dt = 0.0
    for (v in tpl) { val a = v - mt; dt += a * a }
    val x0 = Math.round(px).toInt()
    val y0 = Math.round(py).toInt()
    var best = -2.0
    var bx = x0
    var by = y0
    val cur = FloatArray(cnt)
    for (dy in -search..search) {
      val cy = y0 + dy
      if (cy < 0 || cy >= h) continue
      for (dx in -search..search) {
        val cx = x0 + dx
        if (cx < 0 || cx >= w) continue
        var k = 0
        var mc = 0.0
        for (j in -r..r) {
          val yy = (cy + j).coerceIn(0, h - 1)
          for (i in -r..r) { val v = g[yy * w + (cx + i).coerceIn(0, w - 1)]; cur[k++] = v; mc += v }
        }
        mc /= cnt
        var num = 0.0
        var dc = 0.0
        for (q in 0 until cnt) { val a = tpl[q] - mt; val b = cur[q] - mc; num += a * b; dc += b * b }
        val s = if (dt < 1e-6 || dc < 1e-6) 0.0 else num / Math.sqrt(dt * dc)
        val closer = dx * dx + dy * dy < (bx - x0) * (bx - x0) + (by - y0) * (by - y0)
        if (s > best + 1e-9 || (Math.abs(s - best) <= 1e-9 && closer)) { best = s; bx = cx; by = cy }
      }
    }
    return doubleArrayOf(bx.toDouble(), by.toDouble(), best)
  }
}
