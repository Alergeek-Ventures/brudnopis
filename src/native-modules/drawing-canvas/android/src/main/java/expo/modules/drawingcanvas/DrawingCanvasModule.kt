package expo.modules.drawingcanvas

import android.app.Activity
import com.onyx.android.sdk.api.device.epd.EpdController
import com.onyx.android.sdk.api.device.epd.UpdateMode
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DrawingCanvasModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("DrawingCanvas")

        /**
         * Trigger a full e-ink display refresh (GC waveform).
         * Drives every pixel to black then white, eliminating all ghosting.
         * Decoupled from the canvas view — can be called from anywhere.
         */
        AsyncFunction("refreshScreen") {
            try {
                val activity: Activity = appContext.currentActivity
                    ?: throw IllegalStateException("No current activity")
                val rootView = activity.window.decorView
                EpdController.invalidate(rootView, UpdateMode.GC)
            } catch (e: Throwable) {
                android.util.Log.w("DrawingCanvas", "refreshScreen failed: ${e.message}")
            }
        }

        View(DrawingCanvasView::class) {
            Events("onReady", "onStrokeEnd", "onEraseEnd")

            Prop("backgroundPattern") { view: DrawingCanvasView, pattern: String? ->
                view.setBackgroundPattern(pattern ?: "blank")
            }

            Prop("penType") { view: DrawingCanvasView, style: String? ->
                view.setStrokeStyleProp(style ?: "pencil")
            }

            Prop("strokeColor") { view: DrawingCanvasView, color: String? ->
                view.setStrokeColorProp(color ?: "#000000")
            }

            Prop("strokeWidth") { view: DrawingCanvasView, width: Double? ->
                view.setStrokeWidthProp((width ?: 5.0).toFloat())
            }

            Prop("excludeRects") { view: DrawingCanvasView, rects: List<Map<String, Any>>? ->
                view.setExcludeRectsProp(rects ?: emptyList())
            }

            AsyncFunction("startDrawing") { view: DrawingCanvasView ->
                view.startDrawing()
            }

            AsyncFunction("stopDrawing") { view: DrawingCanvasView ->
                view.stopDrawing()
            }

            AsyncFunction("pauseDrawing") { view: DrawingCanvasView ->
                view.pauseDrawing()
            }

            AsyncFunction("resumeDrawing") { view: DrawingCanvasView ->
                view.resumeDrawing()
            }

            AsyncFunction("clear") { view: DrawingCanvasView ->
                view.clear()
            }

            AsyncFunction("loadStrokes") { view: DrawingCanvasView, strokes: List<Map<String, Any>> ->
                view.loadStrokes(strokes)
            }

            OnViewDestroys { view: DrawingCanvasView ->
                view.cleanup()
            }
        }
    }
}
