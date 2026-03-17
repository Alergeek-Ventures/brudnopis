package expo.modules.drawingcanvas

import android.graphics.Color
import android.graphics.Rect
import android.view.SurfaceView
import com.onyx.android.sdk.data.note.TouchPoint
import com.onyx.android.sdk.pen.RawInputCallback
import com.onyx.android.sdk.pen.TouchHelper
import com.onyx.android.sdk.pen.data.TouchPointList

/**
 * Isolates all Onyx SDK type references into a separate class.
 * This class is only loaded by the JVM when explicitly accessed,
 * so DrawingCanvasView can exist on non-Boox devices without
 * triggering NoClassDefFoundError on class load.
 *
 * The native library (libonyx_pen_touch_reader.so) is bundled in the
 * APK via jniLibs, so System.loadLibrary() finds it in the app's
 * own native lib directory — bypassing Android's linker namespace
 * restrictions that block loading from /system/lib64/.
 */
class OnyxHelper(
    surfaceView: SurfaceView,
    private val onStrokeDrawn: (List<FloatArray>) -> Unit,
    private val onStrokeFinished: () -> Unit,
    private val onEraserDrawn: (List<FloatArray>) -> Unit,
    private val onEraserFinished: () -> Unit,
) {
    private val touchHelper: TouchHelper

    // Pen settings saved during configure(), restored after eraser visual.
    private var penStrokeWidth: Float = 3f
    private var penStrokeColor: Int = Color.BLACK

    /** Width of the eraser visual trail rendered by the SDK on e-ink. */
    private val eraserTrailWidth = 30f
    private val eraserTrailColor = Color.GRAY

    private val callback = object : RawInputCallback() {
        override fun onBeginRawDrawing(b: Boolean, point: TouchPoint?) {}

        override fun onEndRawDrawing(b: Boolean, point: TouchPoint?) {
            onStrokeFinished()
        }

        override fun onRawDrawingTouchPointMoveReceived(point: TouchPoint?) {}

        override fun onRawDrawingTouchPointListReceived(pointList: TouchPointList?) {
            val points = pointList?.points ?: return
            if (points.isEmpty()) return
            val data = points.map { floatArrayOf(it.x, it.y, it.pressure.toFloat()) }
            onStrokeDrawn(data)
        }

        override fun onBeginRawErasing(b: Boolean, point: TouchPoint?) {
            // Switch SDK rendering to a gray marker trail so the user
            // sees a visual indicator of the eraser path on e-ink.
            try {
                touchHelper.setStrokeStyle(TouchHelper.STROKE_STYLE_MARKER)
                touchHelper.setStrokeWidth(eraserTrailWidth)
                touchHelper.setStrokeColor(eraserTrailColor)
            } catch (_: Throwable) {}
        }

        override fun onEndRawErasing(b: Boolean, point: TouchPoint?) {
            // Restore pen rendering settings for the next drawing stroke.
            try {
                touchHelper.setStrokeStyle(TouchHelper.STROKE_STYLE_PENCIL)
                touchHelper.setStrokeWidth(penStrokeWidth)
                touchHelper.setStrokeColor(penStrokeColor)
            } catch (_: Throwable) {}

            onEraserFinished()
        }

        override fun onRawErasingTouchPointMoveReceived(point: TouchPoint?) {}

        override fun onRawErasingTouchPointListReceived(pointList: TouchPointList?) {
            val points = pointList?.points ?: return
            if (points.isEmpty()) return
            val data = points.map { floatArrayOf(it.x, it.y, it.pressure.toFloat()) }
            onEraserDrawn(data)
        }
    }

    init {
        touchHelper = TouchHelper.create(surfaceView, callback)
    }

    fun configure(strokeWidth: Float, strokeColor: Int, viewWidth: Int, viewHeight: Int) {
        penStrokeWidth = strokeWidth
        penStrokeColor = strokeColor

        touchHelper.setStrokeWidth(strokeWidth)
        touchHelper.setStrokeColor(strokeColor)
        touchHelper.setLimitRect(
            Rect(0, 0, viewWidth, viewHeight),
            ArrayList<Rect>()
        )
        try {
            touchHelper.setStrokeStyle(TouchHelper.STROKE_STYLE_PENCIL)
        } catch (_: Throwable) {}
    }

    fun openRawDrawing() {
        touchHelper.openRawDrawing()
        touchHelper.setRawDrawingEnabled(true)
    }

    fun toggleRawDrawing() {
        touchHelper.setRawDrawingEnabled(false)
        touchHelper.setRawDrawingEnabled(true)
    }

    fun close() {
        try {
            touchHelper.setRawDrawingEnabled(false)
            touchHelper.closeRawDrawing()
        } catch (_: Throwable) {}
    }
}
