package expo.modules.drawingcanvas

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.view.SurfaceView
import com.onyx.android.sdk.api.device.epd.EpdController
import com.onyx.android.sdk.data.note.TouchPoint
import com.onyx.android.sdk.pen.RawInputCallback
import com.onyx.android.sdk.pen.TouchHelper
import com.onyx.android.sdk.pen.data.TouchPointList
import kotlin.math.max
import kotlin.math.min

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

        /** Minimum stroke width for fountain pen at zero pressure. */
        private const val MIN_FOUNTAIN_PEN_WIDTH = 1.0f

        /**
         * Smoothing factor for the exponential moving average on stroke width.
         * Lower = smoother (more lag), higher = more responsive.
         * 0.3 provides a good balance: responsive to intentional pressure
         * changes but smooths out digitizer noise.
         */
        private const val WIDTH_SMOOTHING = 0.3f

        /**
         * Pressure curve exponent. Applied as `norm^PRESSURE_CURVE` to the
         * 0.0–1.0 normalized pressure before mapping to width.
         *
         * < 1.0 = concave curve: boosts mid-range pressure → thicker strokes
         *         at moderate pressure. Matches the EPD hardware preview which
         *         is slightly more generous than a linear mapping.
         * = 1.0 = linear (no curve).
         * > 1.0 = convex curve: attenuates mid-range → thinner strokes.
         */
        private const val PRESSURE_CURVE = 0.7f

        /**
         * Render fountain pen strokes with pressure-variable width.
         *
         * Custom renderer that replaces NeoFountainPenWrapper.drawStroke().
         * The SDK's wrapper uses NeoFountainPen (a black-box class on the
         * device) whose pressure-to-width curve doesn't match the EPD
         * hardware preview. This renderer uses a direct linear mapping with
         * exponential smoothing, producing output that closely matches what
         * the user sees while drawing on the e-ink layer.
         *
         * Algorithm:
         * 1. Normalize raw pressure (0–maxTouchPressure) → (0.0–1.0)
         * 2. Apply concave power curve (norm^0.7) to boost mid-range widths
         * 3. Map to width: minWidth + curved * (maxWidth - minWidth)
         * 4. Smooth width with EMA to avoid jagged transitions
         * 5. Draw per-segment lines with FILL_AND_STROKE + Cap.ROUND
         *    (same technique as SDK's PenUtils.drawStrokeByPointSize)
         *
         * @param canvas    The bitmap canvas to draw on.
         * @param paint     Paint with the desired color (will be temporarily modified).
         * @param points    List of [x, y, pressure, timestamp] float arrays.
         *                  Pressure is raw from the digitizer (0–maxTouchPressure).
         * @param baseWidth The configured stroke width — used as maxWidth.
         */
        fun renderFountainPen(canvas: Canvas, paint: Paint, points: List<FloatArray>, baseWidth: Float) {
            if (points.size < 2) return

            val rawMax = EpdController.getMaxTouchPressure()
            val maxTouchPressure = if (rawMax > 0f) rawMax else EpdController.MAX_TOUCH_PRESSURE

            // DEBUG: log pressure values entering the fountain pen renderer
            val pressureSample = points.take(5).joinToString { String.format("%.4f", it[2]) }
            android.util.Log.d("DrawingCanvas", "renderFountainPen: ${points.size} pts, baseWidth=$baseWidth, maxTouchPressure=$maxTouchPressure, raw pressures=[$pressureSample]")

            // Save original paint state
            val origStyle = paint.style
            val origCap = paint.strokeCap
            val origJoin = paint.strokeJoin
            val origAntiAlias = paint.isAntiAlias
            val origWidth = paint.strokeWidth

            // Configure paint to match PenUtils.drawStrokeByPointSize behavior
            paint.style = Paint.Style.FILL_AND_STROKE
            paint.strokeCap = Paint.Cap.ROUND
            paint.strokeJoin = Paint.Join.ROUND
            paint.isAntiAlias = true

            val widthRange = baseWidth - MIN_FOUNTAIN_PEN_WIDTH

            // Initialize smoothed width from first point's pressure
            val firstNorm = Math.pow(min(1f, max(0f, points[0][2] / maxTouchPressure)).toDouble(), PRESSURE_CURVE.toDouble()).toFloat()
            var smoothedWidth = MIN_FOUNTAIN_PEN_WIDTH + firstNorm * widthRange

            for (i in 0 until points.size - 1) {
                val p0 = points[i]
                val p1 = points[i + 1]

                // Normalize pressure of the target point to 0.0–1.0, then
                // apply concave power curve to boost mid-range widths.
                val linear = min(1f, max(0f, p1[2] / maxTouchPressure))
                val norm = Math.pow(linear.toDouble(), PRESSURE_CURVE.toDouble()).toFloat()
                val targetWidth = MIN_FOUNTAIN_PEN_WIDTH + norm * widthRange

                // Smooth with exponential moving average
                smoothedWidth += (targetWidth - smoothedWidth) * WIDTH_SMOOTHING

                paint.strokeWidth = smoothedWidth
                canvas.drawLine(p0[0], p0[1], p1[0], p1[1], paint)
            }

            // Restore paint state
            paint.style = origStyle
            paint.strokeCap = origCap
            paint.strokeJoin = origJoin
            paint.isAntiAlias = origAntiAlias
            paint.strokeWidth = origWidth
        }
    }
}
