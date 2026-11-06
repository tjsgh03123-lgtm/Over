package expo.modules.posecamera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.view.View
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

private const val LM_COUNT = 33

/**
 * 카메라 미리보기 + 실시간 관절 검출. 프레임마다 33개 관절(x,y,신뢰도)을 onPose로 보낸다.
 * 좌표는 '똑바로 세운 화면 기준 0~1'이며, 앞카메라일 때는 보이는 화면(거울)과 맞게 x를 뒤집어 보낸다.
 */
class PoseCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onPose by EventDispatcher()
  private val onError by EventDispatcher()

  var active = false
  var front = false
  var model = "lite"

  private val previewView = PreviewView(context).apply {
    scaleType = PreviewView.ScaleType.FIT_CENTER
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
  }
  private var executor: ExecutorService? = null
  private var provider: ProcessCameraProvider? = null
  private var landmarker: PoseLandmarker? = null
  private var landmarkerModel: String? = null
  private var running = false
  private var boundFront = false
  private var boundModel = ""
  private var lastEmit = 0L
  private var errorSent = false

  init {
    addView(previewView)
  }

  // React Native는 안드로이드 기본 레이아웃을 건너뛰므로, 미리보기 화면(TextureView)이 크기를 갖도록 직접 측정·배치한다
  private val measureAndLayout = Runnable {
    val w = width
    val h = height
    if (w > 0 && h > 0) {
      previewView.measure(
        View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY),
      )
      previewView.layout(0, 0, w, h)
    }
  }

  override fun requestLayout() {
    super.requestLayout()
    post(measureAndLayout)
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    measureAndLayout.run()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    update()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    stop()
  }

  fun update() {
    if (!isAttachedToWindow) return
    if (!active) { stop(); return }
    if (running && boundFront == front && boundModel == model) return
    stop()
    start()
  }

  private fun fail(code: String, msg: String) {
    onError(mapOf("code" to code, "message" to msg))
  }

  private fun start() {
    val owner = appContext.currentActivity as? LifecycleOwner
    if (owner == null) { fail("NO_ACTIVITY", "화면을 찾을 수 없습니다"); return }
    try {
      if (landmarker == null || landmarkerModel != model) {
        landmarker?.close()
        val base = BaseOptions.builder().setModelAssetPath("pose_landmarker_$model.task").build()
        val opts = PoseLandmarker.PoseLandmarkerOptions.builder()
          .setBaseOptions(base)
          .setRunningMode(RunningMode.VIDEO)
          .setNumPoses(1)
          .setMinPoseDetectionConfidence(0.5f)
          .setMinPosePresenceConfidence(0.5f)
          .setMinTrackingConfidence(0.5f)
          .build()
        landmarker = PoseLandmarker.createFromOptions(context, opts)
        landmarkerModel = model
      }
    } catch (e: Exception) {
      fail("MODEL", "포즈 모델을 불러올 수 없습니다: ${e.message}")
      return
    }

    running = true
    boundFront = front
    boundModel = model
    val exec = Executors.newSingleThreadExecutor()
    executor = exec
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      try {
        if (!running) return@addListener
        val p = future.get()
        provider = p
        val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
        val analysis = ImageAnalysis.Builder()
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
          .build()
        analysis.setAnalyzer(exec) { proxy -> analyze(proxy) }
        val selector = if (front) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
        p.unbindAll()
        p.bindToLifecycle(owner, selector, preview, analysis)
      } catch (e: Exception) {
        running = false
        fail("CAMERA", "카메라를 열 수 없습니다: ${e.message}")
      }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun stop() {
    running = false
    try { provider?.unbindAll() } catch (_: Exception) {}
    provider = null
    executor?.shutdown()
    executor = null
  }

  private fun analyze(proxy: ImageProxy) {
    try {
      val lm = landmarker
      if (!running || lm == null) return
      var bmp: Bitmap = proxy.toBitmap()
      val rot = proxy.imageInfo.rotationDegrees
      if (rot != 0) {
        val m = Matrix().apply { postRotate(rot.toFloat()) }
        val r = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        if (r !== bmp) bmp.recycle()
        bmp = r
      }
      val w = bmp.width
      val h = bmp.height
      val tsMs = proxy.imageInfo.timestamp / 1_000_000L
      val res = lm.detectForVideo(BitmapImageBuilder(bmp).build(), tsMs)
      bmp.recycle()

      val now = System.currentTimeMillis()
      if (now - lastEmit < 30) return // 초당 약 30번까지만 전달
      lastEmit = now

      val out = ArrayList<Double>(LM_COUNT * 3)
      val poses = res.landmarks()
      if (poses.isNotEmpty() && poses[0].size >= LM_COUNT) {
        val p = poses[0]
        for (k in 0 until LM_COUNT) {
          val x = p[k].x().toDouble()
          out.add(if (boundFront) 1.0 - x else x)
          out.add(p[k].y().toDouble())
          out.add(p[k].visibility().orElse(0f).toDouble())
        }
      } else {
        for (k in 0 until LM_COUNT * 3) out.add(0.0)
      }
      onPose(mapOf("lm" to out, "w" to w, "h" to h, "t" to tsMs.toDouble()))
    } catch (e: Exception) {
      if (!errorSent) { errorSent = true; fail("ANALYZE", "분석 중 오류: ${e.message}") }
    } finally {
      proxy.close()
    }
  }
}
