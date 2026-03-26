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
                // EpdController.invalidate calls View.invalidate internally,
                // which MUST run on the UI thread. Module-level AsyncFunctions
                // run on the background AsyncFunctionQueue by default.
                activity.runOnUiThread {
                    try {
                        // Force the entire view hierarchy to redraw — ensures
                        // the e-ink panel receives fresh content after raw
                        // drawing mode unfreezes.
                        rootView.invalidate()
                        rootView.requestLayout()
                        // repaintEveryThing forces a full GC waveform refresh
                        // across the entire screen, not just the passed view.
                        EpdController.repaintEveryThing(UpdateMode.GC)
                        android.util.Log.i("DrawingCanvas", "refreshScreen: repaintEveryThing(GC) on UI thread")
                    } catch (e: Throwable) {
                        android.util.Log.w("DrawingCanvas", "refreshScreen (UI thread) failed: ${e.message}", e)
                    }
                }
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
