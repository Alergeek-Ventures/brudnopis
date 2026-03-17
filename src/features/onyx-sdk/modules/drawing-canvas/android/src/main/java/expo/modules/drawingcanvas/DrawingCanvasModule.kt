package expo.modules.drawingcanvas

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DrawingCanvasModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("DrawingCanvas")

        View(DrawingCanvasView::class) {
            Events("onStrokeEnd")

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
