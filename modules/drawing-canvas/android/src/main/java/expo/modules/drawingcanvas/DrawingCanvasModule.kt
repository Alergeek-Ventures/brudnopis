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

            OnViewDestroys { view: DrawingCanvasView ->
                view.cleanup()
            }
        }
    }
}
