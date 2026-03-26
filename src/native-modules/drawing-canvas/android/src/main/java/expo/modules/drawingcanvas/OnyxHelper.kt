package expo.modules.drawingcanvas

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.view.SurfaceView
import com.onyx.android.sdk.api.device.epd.EpdController
import com.onyx.android.sdk.data.note.TouchPoint
import com.onyx.android.sdk.pen.NeoFountainPenWrapper
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
    private var penStrokeStyle: Int = TouchHelper.STROKE_STYLE_PENCIL

    // Canvas dimensions, saved for re-calling setLimitRect when exclude rects change.
    private var canvasWidth: Int = 0
    private var canvasHeight: Int = 0

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
            // DEBUG: log raw pressure values from the SDK digitizer
            val pressureSample = points.take(5).joinToString { String.format("%.4f", it.pressure) }
            android.util.Log.d("DrawingCanvas", "SDK callback: ${points.size} pts, first pressures=[$pressureSample]")
            val data = points.map { floatArrayOf(it.x, it.y, it.pressure.toFloat(), it.timestamp.toFloat()) }
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
                touchHelper.setStrokeStyle(penStrokeStyle)
                touchHelper.setStrokeWidth(penStrokeWidth)
                touchHelper.setStrokeColor(penStrokeColor)
            } catch (_: Throwable) {}

            onEraserFinished()
        }

        override fun onRawErasingTouchPointMoveReceived(point: TouchPoint?) {}

        override fun onRawErasingTouchPointListReceived(pointList: TouchPointList?) {
            val points = pointList?.points ?: return
            if (points.isEmpty()) return
            val data = points.map { floatArrayOf(it.x, it.y, it.pressure.toFloat(), it.timestamp.toFloat()) }
            onEraserDrawn(data)
        }
    }

    init {
        touchHelper = TouchHelper.create(surfaceView, callback)
    }

    fun configure(strokeWidth: Float, strokeColor: Int, strokeStyle: Int, viewWidth: Int, viewHeight: Int) {
        penStrokeWidth = strokeWidth
        penStrokeColor = strokeColor
        penStrokeStyle = strokeStyle
        canvasWidth = viewWidth
        canvasHeight = viewHeight

        touchHelper.setStrokeWidth(strokeWidth)
        touchHelper.setStrokeColor(strokeColor)
        touchHelper.setLimitRect(
            Rect(0, 0, viewWidth, viewHeight),
            ArrayList<Rect>()
        )
        try {
            touchHelper.setStrokeStyle(strokeStyle)
        } catch (_: Throwable) {}
    }

    /**
     * Update pen stroke style at runtime. Called when the strokeStyle prop changes.
     */
    fun updateStrokeStyle(style: Int) {
        penStrokeStyle = style
        try {
            touchHelper.setStrokeStyle(style)
        } catch (_: Throwable) {}
    }

    /**
     * Update pen stroke color at runtime. Called when the strokeColor prop changes.
     */
    fun updateStrokeColor(color: Int) {
        penStrokeColor = color
        try {
            touchHelper.setStrokeColor(color)
        } catch (_: Throwable) {}
    }

    /**
     * Update pen stroke width at runtime. Called when the strokeWidth prop changes.
     */
    fun updateStrokeWidth(width: Float) {
        penStrokeWidth = width
        try {
            touchHelper.setStrokeWidth(width)
        } catch (_: Throwable) {}
    }

    /**
     * Update the exclude rects — areas where the SDK should NOT capture pen input.
     * Re-calls setLimitRect with the full canvas as the limit and the given rects
     * as exclusion zones.
     *
     * Note: setLimitRect takes effect on the next pen-down event without needing
     * a raw drawing toggle. Toggling would clear the e-ink live pen layer and
     * cause visible flickering.
     */
    fun updateExcludeRects(rects: List<Rect>) {
        if (canvasWidth <= 0 || canvasHeight <= 0) return
        try {
            touchHelper.setLimitRect(
                Rect(0, 0, canvasWidth, canvasHeight),
                ArrayList(rects)
            )
        } catch (_: Throwable) {}
    }

    fun openRawDrawing() {
        touchHelper.openRawDrawing()
        touchHelper.setRawDrawingEnabled(true)
    }

    fun setRawDrawingEnabled(enabled: Boolean) {
        touchHelper.setRawDrawingEnabled(enabled)
    }

    fun toggleRawDrawing() {
        touchHelper.setRawDrawingEnabled(false)
        touchHelper.setRawDrawingEnabled(true)
    }

    fun close() {
        try {
            android.util.Log.i("DrawingCanvas", "OnyxHelper.close: disabling raw drawing")
            touchHelper.setRawDrawingEnabled(false)
            android.util.Log.i("DrawingCanvas", "OnyxHelper.close: calling closeRawDrawing")
            touchHelper.closeRawDrawing()
            android.util.Log.i("DrawingCanvas", "OnyxHelper.close: done — screen should unfreeze")
        } catch (e: Throwable) {
            android.util.Log.e("DrawingCanvas", "OnyxHelper.close FAILED: ${e.javaClass.name}: ${e.message}", e)
        }
    }

    companion object {
        /** Map JS stroke style strings to Onyx SDK stroke style constants. */
        fun styleStringToInt(style: String): Int = when (style) {
            "fountain" -> TouchHelper.STROKE_STYLE_FOUNTAIN
            "marker" -> TouchHelper.STROKE_STYLE_MARKER
            else -> TouchHelper.STROKE_STYLE_PENCIL
        }

        /**
         * Render fountain pen strokes using the SDK's NeoFountainPenWrapper.
         *
         * This delegates to the same pressure-to-width algorithm that the SDK
         * uses for the live e-ink hardware preview, ensuring the bitmap
         * matches what the user saw while drawing.
         *
         * @param canvas    The bitmap canvas to draw on.
         * @param paint     Paint with the desired color.
         * @param points    List of [x, y, pressure, timestamp] float arrays.
         *                  Pressure is raw from the digitizer (0–maxTouchPressure).
         * @param baseWidth The configured stroke width.
         */
        fun renderFountainPen(canvas: Canvas, paint: Paint, points: List<FloatArray>, baseWidth: Float) {
            if (points.size < 2) return

            val rawMax = EpdController.getMaxTouchPressure()
            val maxTouchPressure = if (rawMax > 0f) rawMax else EpdController.MAX_TOUCH_PRESSURE

            // Convert FloatArray points to SDK TouchPoint objects
            val touchPoints = points.map { p ->
                TouchPoint(p[0], p[1], p[2], 0f, p[3].toLong())
            }

            // displayScale = 1.0 since we draw in native pixel coordinates
            NeoFountainPenWrapper.drawStroke(
                canvas, paint, touchPoints,
                1.0f, baseWidth, maxTouchPressure, false,
            )
        }
    }
}
