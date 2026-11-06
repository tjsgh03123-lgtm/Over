package expo.modules.posecamera

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PoseCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PoseCamera")

    View(PoseCameraView::class) {
      Events("onPose", "onError")

      Prop("active") { view: PoseCameraView, value: Boolean ->
        view.active = value
        view.update()
      }
      Prop("front") { view: PoseCameraView, value: Boolean ->
        view.front = value
        view.update()
      }
      Prop("model") { view: PoseCameraView, value: String ->
        view.model = if (value == "full") "full" else "lite"
        view.update()
      }
    }
  }
}
