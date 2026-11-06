package expo.modules.poseanalyzer

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.util.Base64
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

class AnalyzeOptions : Record {
  @Field var startMs: Double = 0.0
  @Field var endMs: Double = 0.0
  @Field var fps: Double = 15.0
  @Field var model: String = "full" // lite | full | heavy
  @Field var jobId: String = ""
}

private const val LM_COUNT = 33
private const val MAX_SIDE = 512
private class Frame(val index: Int, val bitmap: Bitmap?)

/**
 * 영상 구간에서 일정 간격으로 프레임을 꺼내 MediaPipe 포즈 모델로 33개 관절을 찾는다.
 * 프레임 꺼내기(생산)와 추론(소비)을 다른 스레드에서 동시에 돌려 대기 시간을 줄인다.
 * 결과는 좌표를 압축한 base64 문자열로 돌려준다 (JS 쪽 decodeTrack과 같은 형식, 관절당 5바이트).
 */
class PoseAnalyzerModule : Module() {
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

  override fun definition() = ModuleDefinition {
    Name("PoseAnalyzer")
    Events("onProgress")

    AsyncFunction("getVideoInfo") { uri: String ->
      val r = open(uri)
      try {
        val dur = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
        var w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
        var h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
        val rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
        if (rot == 90 || rot == 270) { val t = w; w = h; h = t }
        mapOf("durationMs" to dur.toDouble(), "width" to w, "height" to h, "rotation" to rot)
      } finally {
        r.release()
      }
    }

    Function("cancel") { jobId: String ->
      cancels[jobId]?.set(true)
    }

    AsyncFunction("analyze") { uri: String, o: AnalyzeOptions ->
      val cancel = AtomicBoolean(false)
      cancels[o.jobId] = cancel
      try {
        runAnalysis(uri, o, cancel)
      } finally {
        cancels.remove(o.jobId)
      }
    }
  }

  private fun runAnalysis(uri: String, o: AnalyzeOptions, cancel: AtomicBoolean): String {
    val fps = if (o.fps <= 0) 15.0 else o.fps
    val stepMs = 1000.0 / fps
    val total = Math.floor((o.endMs - o.startMs) / stepMs).toInt() + 1
    if (total <= 0) throw CodedException("BAD_RANGE", "분석 구간이 올바르지 않습니다", null)
    val model = when (o.model) { "lite", "full", "heavy" -> o.model; else -> "full" }

    val retriever = open(uri)
    var landmarker: PoseLandmarker? = null
    try {
      var w = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
      var h = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
      val rot = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      if (rot == 90 || rot == 270) { val t = w; w = h; h = t }
      if (w <= 0 || h <= 0) throw CodedException("OPEN_FAILED", "영상 크기를 읽을 수 없습니다", null)
      val scale = Math.min(1.0, MAX_SIDE.toDouble() / Math.max(w, h))
      val dw = Math.max(2, Math.round(w * scale).toInt())
      val dh = Math.max(2, Math.round(h * scale).toInt())

      try {
        val base = BaseOptions.builder().setModelAssetPath("pose_landmarker_$model.task").build()
        val opts = PoseLandmarker.PoseLandmarkerOptions.builder()
          .setBaseOptions(base)
          .setRunningMode(RunningMode.VIDEO)
          .setNumPoses(1)
          .setMinPoseDetectionConfidence(0.5f)
          .setMinPosePresenceConfidence(0.5f)
          .setMinTrackingConfidence(0.5f)
          .build()
        landmarker = PoseLandmarker.createFromOptions(ctx(), opts)
      } catch (e: Exception) {
        throw CodedException("MODEL_MISSING", "포즈 모델($model)을 불러올 수 없습니다: ${e.message}", e)
      }

      val queue = ArrayBlockingQueue<Frame>(4)
      val producerError = AtomicReference<Throwable?>(null)
      val producer = Thread {
        try {
          for (i in 0 until total) {
            if (cancel.get()) break
            val tUs = ((o.startMs + i * stepMs) * 1000.0).toLong()
            var bmp: Bitmap? = null
            try {
              bmp = if (Build.VERSION.SDK_INT >= 27) {
                retriever.getScaledFrameAtTime(tUs, MediaMetadataRetriever.OPTION_CLOSEST, dw, dh)
              } else {
                retriever.getFrameAtTime(tUs, MediaMetadataRetriever.OPTION_CLOSEST)?.let {
                  if (it.width > dw) Bitmap.createScaledBitmap(it, dw, dh, true) else it
                }
              }
              if (bmp != null && bmp.config != Bitmap.Config.ARGB_8888) {
                val c = bmp.copy(Bitmap.Config.ARGB_8888, false)
                bmp.recycle()
                bmp = c
              }
            } catch (e: Exception) {
              bmp = null // 이 프레임만 건너뜀 (사람 없음으로 처리)
            }
            while (!cancel.get() && !queue.offer(Frame(i, bmp), 200, TimeUnit.MILLISECONDS)) { /* 소비 대기 */ }
          }
        } catch (e: Throwable) {
          producerError.set(e)
        } finally {
          // 끝 표시
          while (!queue.offer(Frame(-1, null), 200, TimeUnit.MILLISECONDS)) {
            if (cancel.get()) { queue.clear() }
          }
        }
      }
      producer.start()

      val bytes = ByteArray(total * LM_COUNT * 5)
      var lastEmit = 0L
      var done = 0
      val lm = landmarker!!
      try {
        while (true) {
          val f = queue.poll(500, TimeUnit.MILLISECONDS) ?: continue
          if (f.index < 0) break
          if (cancel.get()) { f.bitmap?.recycle(); continue }
          val bmp = f.bitmap
          var found = false
          if (bmp != null) {
            try {
              val res = lm.detectForVideo(BitmapImageBuilder(bmp).build(), (f.index * stepMs).toLong())
              val poses = res.landmarks()
              if (poses.isNotEmpty() && poses[0].size >= LM_COUNT) {
                val p = poses[0]
                for (k in 0 until LM_COUNT) {
                  val x = p[k].x(); val y = p[k].y()
                  val v = p[k].visibility().orElse(0f)
                  put(bytes, (f.index * LM_COUNT + k) * 5, x, y, v)
                }
                found = true
              }
            } finally {
              bmp.recycle()
            }
          }
          if (!found) {
            // 사람을 찾지 못한 프레임: 좌표 0, 신뢰도 0
            for (k in 0 until LM_COUNT) put(bytes, (f.index * LM_COUNT + k) * 5, 0f, 0f, 0f)
          }
          done++
          val now = System.currentTimeMillis()
          if (now - lastEmit > 150 || done == total) {
            lastEmit = now
            sendEvent("onProgress", mapOf("jobId" to o.jobId, "done" to done, "total" to total))
          }
        }
      } catch (e: Throwable) {
        cancel.set(true) // 생산 스레드가 막히지 않게 멈춘다
        throw e
      } finally {
        producer.join(3000)
      }

      producerError.get()?.let { throw CodedException("DECODE_FAILED", "영상 프레임을 읽는 중 오류: ${it.message}", it) }
      if (cancel.get()) throw CodedException("CANCELLED", "분석이 취소되었습니다", null)
      return Base64.encodeToString(bytes, Base64.NO_WRAP)
    } finally {
      try { landmarker?.close() } catch (_: Exception) {}
      try { retriever.release() } catch (_: Exception) {}
    }
  }

  /** JS decodeTrack과 같은 형식: x,y는 (-0.5..1.5)를 uint16, 신뢰도는 uint8 */
  private fun put(b: ByteArray, off: Int, x: Float, y: Float, v: Float) {
    val qx = Math.round((Math.max(-0.5f, Math.min(1.5f, x)) + 0.5f) * 32767.5f)
    val qy = Math.round((Math.max(-0.5f, Math.min(1.5f, y)) + 0.5f) * 32767.5f)
    val qv = Math.round(Math.max(0f, Math.min(1f, v)) * 255f)
    b[off] = (qx shr 8).toByte(); b[off + 1] = (qx and 255).toByte()
    b[off + 2] = (qy shr 8).toByte(); b[off + 3] = (qy and 255).toByte()
    b[off + 4] = qv.toByte()
  }
}
