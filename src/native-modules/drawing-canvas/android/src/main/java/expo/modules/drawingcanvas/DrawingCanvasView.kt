package expo.modules.drawingcanvas

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Region
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Retained stroke data for eraser hit-testing and bitmap redraw.
 * Mirrors the JS-side Stroke type — kept in sync via index.
 */
private data class StrokeData(
    val points: List<FloatArray>,
    val color: Int,
    val width: Float,
    /** Pen style — "pencil", "fountain", or "marker". */
    val style: String,
    /** Pre-computed bounding box for fast eraser pre-filtering. */
    val bounds: RectF,
)

/**
 * Native drawing canvas. Uses Onyx Boox SDK (via OnyxHelper) for
 * low-latency pen input when available. On non-Boox devices, shows
 * a static white surface.
 *
 * IMPORTANT: This class must NOT reference any Onyx SDK types directly.
 * All SDK access goes through OnyxHelper, which is loaded lazily.
 * This prevents NoClassDefFoundError on non-Boox devices.
 */
class DrawingCanvasView(
    context: Context,
    appContext: AppContext
) : ExpoView(context, appContext) {

    override val shouldUseAndroidLayout: Boolean = true

    val onReady by EventDispatcher()
    val onStrokeEnd by EventDispatcher()
    val onEraseEnd by EventDispatcher()

    private var bitmap: Bitmap? = null
    private var bitmapCanvas: Canvas? = null
    private var strokeCount: Int = 0

    // Accumulates points for the current stroke across multiple batches.
    // Each FloatArray is [x, y, pressure, timestamp]. Cleared on stroke end.
    private val currentStrokePoints = mutableListOf<FloatArray>()

    // Accumulates eraser path points across multiple batches.
    // Each FloatArray is [x, y, pressure, timestamp]. Cleared on erase end.
    private val currentEraserPoints = mutableListOf<FloatArray>()

    // Retained strokes for eraser hit-testing and bitmap redraw.
    // Kept in sync with JS strokesRef by index — eraseEnd reports
    // indices to splice, and new strokes are always appended.
    private val strokes = mutableListOf<StrokeData>()

    // Current pen settings — updated via props from React Native.
    private var currentStrokeStyle: String = "pencil"
    private var currentStrokeColor: Int = Color.BLACK
    private var currentStrokeWidth: Float = 5f

    private val strokePaint = Paint().apply {
        color = Color.BLACK
        strokeWidth = 5f
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        isAntiAlias = true
    }

    private val bitmapPaint = Paint()

    // ── Background pattern ─────────────────────────────────────────

    private var backgroundPattern: String = "blank"

    /** Dot spacing in pixels. ~80px ≈ 9mm at 226 DPI (Boox standard). */
    private val dotSpacing = 80f
    /** Dot radius in pixels. */
    private val dotRadius = 3f

    private val dotPaint = Paint().apply {
        color = Color.LTGRAY
        style = Paint.Style.FILL
        isAntiAlias = true
        strokeCap = Paint.Cap.ROUND
    }

    // ── Eraser hit-testing ─────────────────────────────────────────

    /** Paint used to expand the eraser path into a corridor via getFillPath. */
    private val eraserExpansionPaint = Paint().apply {
        style = Paint.Style.STROKE
        strokeWidth = 30f
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    // OnyxHelper is typed as Any? to avoid referencing SDK types.
    // Actual type is OnyxHelper, loaded lazily in initTouchHelper().
    private var onyxHelper: Any? = null

    private val surfaceView = SurfaceView(context)

    private val surfaceCallback = object : SurfaceHolder.Callback {
        override fun surfaceCreated(holder: SurfaceHolder) {
            val w = surfaceView.width
            val h = surfaceView.height
            if (w <= 0 || h <= 0) return

            bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            bitmapCanvas = Canvas(bitmap!!)
            drawBackground(bitmapCanvas!!, w, h)
            drawBitmapToSurface()

            // Initialize the Onyx SDK but do NOT open raw drawing yet.
            // Raw drawing freezes the e-ink screen for normal Android rendering,
            // so we must finish loading + rendering existing strokes first.
            // The JS-side XState machine calls startDrawing() after loadStrokes.
            initTouchHelper()

            // Signal to JS that the canvas is ready to receive commands.
            onReady(emptyMap<String, Any>())
        }

        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            val oldBitmap = bitmap
            if (oldBitmap != null && (oldBitmap.width != width || oldBitmap.height != height)) {
                val newBitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                val newCanvas = Canvas(newBitmap)
                drawBackground(newCanvas, width, height)
                newCanvas.drawBitmap(oldBitmap, 0f, 0f, bitmapPaint)
                bitmap = newBitmap
                bitmapCanvas = newCanvas
                oldBitmap.recycle()
            }
        }

        override fun surfaceDestroyed(holder: SurfaceHolder) {
            closeTouchHelper()
        }
    }

    init {
        surfaceView.holder.addCallback(surfaceCallback)
        addView(surfaceView, ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ))
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        surfaceView.layout(0, 0, r - l, b - t)
    }

    // ── Background rendering ───────────────────────────────────────

    /**
     * Draw the canvas background (white fill + optional dot grid).
     * Called from surfaceCreated, surfaceChanged, loadStrokes, clear,
     * and after eraser redraw.
     */
    private fun drawBackground(canvas: Canvas, width: Int, height: Int) {
        canvas.drawColor(Color.WHITE)

        if (backgroundPattern == "dotted") {
            drawDottedBackground(canvas, width, height)
        }
    }

    /**
     * Draw a dot grid pattern using drawPoints for efficiency.
     * A single drawPoints call with Cap.ROUND renders all dots
     * as circles — much faster than individual drawCircle calls.
     */
    private fun drawDottedBackground(canvas: Canvas, width: Int, height: Int) {
        // Count dots to pre-allocate the float array
        val cols = ((width - dotSpacing) / dotSpacing).toInt() + 1
        val rows = ((height - dotSpacing) / dotSpacing).toInt() + 1
        if (cols <= 0 || rows <= 0) return

        // drawPoints takes pairs of (x, y) floats
        val points = FloatArray(cols * rows * 2)
        var idx = 0
        for (row in 0 until rows) {
            val y = dotSpacing + row * dotSpacing
            for (col in 0 until cols) {
                val x = dotSpacing + col * dotSpacing
                points[idx++] = x
                points[idx++] = y
            }
        }

        // strokeWidth controls the dot diameter with Cap.ROUND
        dotPaint.strokeWidth = dotRadius * 2
        canvas.drawPoints(points, 0, idx, dotPaint)
    }

    // ── Onyx integration (all SDK access via OnyxHelper) ───────────

    /**
     * Initialize the Onyx SDK TouchHelper and configure it, but do NOT open
     * raw drawing. Raw drawing freezes the e-ink screen for normal Android
     * rendering — opening it must be deferred until after existing strokes
     * are loaded and blitted to the SurfaceView.
     *
     * Call startDrawing() separately to open raw drawing mode.
     */
    private fun initTouchHelper() {
        try {
            val helper = OnyxHelper(
                surfaceView = surfaceView,
                onStrokeDrawn = { points -> handleStrokePoints(points) },
                onStrokeFinished = { refreshAfterStroke() },
                onEraserDrawn = { points -> handleEraserPoints(points) },
                onEraserFinished = { handleEraseEnd() },
            )
            val sdkStyle = try { OnyxHelper.styleStringToInt(currentStrokeStyle) } catch (_: Throwable) { 0 }
            helper.configure(strokePaint.strokeWidth, strokePaint.color, sdkStyle, surfaceView.width, surfaceView.height)
            onyxHelper = helper
            android.util.Log.i("DrawingCanvas", "OnyxHelper initialized (raw drawing NOT started)")
        } catch (e: NoClassDefFoundError) {
            android.util.Log.w("DrawingCanvas", "Onyx SDK not available: ${e.message}")
            onyxHelper = null
        } catch (e: Throwable) {
            android.util.Log.e("DrawingCanvas", "OnyxHelper init failed: ${e.javaClass.name}: ${e.message}")
            e.printStackTrace()
            onyxHelper = null
        }
    }

    /**
     * Open raw drawing mode — freezes the e-ink screen for Android rendering
     * and starts capturing stylus input. Called by the JS-side XState machine
     * AFTER loadStrokes has completed and the bitmap is visible on screen.
     */
    fun startDrawing() {
        try {
            val helper = onyxHelper as? OnyxHelper ?: return
            helper.openRawDrawing()
            android.util.Log.i("DrawingCanvas", "Raw drawing started")
        } catch (e: Throwable) {
            android.util.Log.w("DrawingCanvas", "startDrawing failed: ${e.message}")
        }
    }

    /**
     * Close raw drawing mode permanently — disables SDK input capture and
     * releases resources. The SurfaceView surface stays alive so the bitmap
     * remains visible until the view unmounts.
     *
     * Blits the current bitmap to the SurfaceView BEFORE closing raw drawing
     * so the e-ink panel shows up-to-date content (including new strokes drawn
     * during this session) when the screen unfreezes.
     *
     * Idempotent: safe to call when raw drawing is already closed.
     * Called by the JS-side XState machine before navigating away.
     */
    fun stopDrawing() {
        drawBitmapToSurface()
        closeTouchHelper()
        android.util.Log.i("DrawingCanvas", "Raw drawing stopped")
    }

    /**
     * Temporarily disable raw drawing — unfreezes the e-ink screen for normal
     * Android rendering so overlay views (toolbar) receive touch events.
     * Blits the current bitmap to the SurfaceView first so the user sees
     * up-to-date content while drawing is paused.
     *
     * Call resumeDrawing() to re-enable. Does NOT null the OnyxHelper.
     */
    fun pauseDrawing() {
        try {
            drawBitmapToSurface()
            val helper = onyxHelper as? OnyxHelper ?: return
            helper.setRawDrawingEnabled(false)
            android.util.Log.i("DrawingCanvas", "Raw drawing paused")
        } catch (e: Throwable) {
            android.util.Log.w("DrawingCanvas", "pauseDrawing failed: ${e.message}")
        }
    }

    /**
     * Re-enable raw drawing after a pause. Freezes the e-ink screen again
     * and resumes stylus input capture.
     */
    fun resumeDrawing() {
        try {
            val helper = onyxHelper as? OnyxHelper ?: return
            helper.setRawDrawingEnabled(true)
            android.util.Log.i("DrawingCanvas", "Raw drawing resumed")
        } catch (e: Throwable) {
            android.util.Log.w("DrawingCanvas", "resumeDrawing failed: ${e.message}")
        }
    }

    private fun handleStrokePoints(points: List<FloatArray>) {
        if (points.isEmpty()) return

        // Accumulate points for serialization on stroke end
        currentStrokePoints.addAll(points)

        // For fountain pen: skip per-batch bitmap rendering. The SDK's
        // NeoFountainPenWrapper uses internal state (pressure smoothing,
        // width interpolation) that resets between calls, so rendering
        // partial batches produces a different result than a single full-
        // stroke call. We render the complete stroke once in
        // refreshAfterStroke() instead. The SDK's own e-ink layer handles
        // the live preview, so the user still sees the stroke while drawing.
        if (currentStrokeStyle != "fountain") {
            renderPointsToBitmap(points, strokePaint, currentStrokeStyle)
        }
        strokeCount++
    }

    /**
     * Render a list of [x, y, pressure, timestamp] points to the bitmap canvas.
     * Pure rendering — no side effects on stroke state.
     *
     * For "fountain" style, varies stroke width per segment based on pressure
     * data (index 2 of each point). For all other styles, draws a constant-
     * width path using the paint's strokeWidth.
     */
    private fun renderPointsToBitmap(points: List<FloatArray>, paint: Paint, style: String = "pencil") {
        val canvas = bitmapCanvas ?: return
        if (points.isEmpty()) return

        if (style == "fountain") {
            renderFountainToBitmap(points, paint)
            return
        }

        val path = Path()
        var prevX = points[0][0]
        var prevY = points[0][1]
        path.moveTo(prevX, prevY)

        for (i in 1 until points.size) {
            val x = points[i][0]
            val y = points[i][1]
            // Skip large vertical jumps (artifact filtering, from PngNote)
            if (abs(prevY - y) >= 30 && abs(prevX - x) < 2) continue
            path.quadTo(prevX, prevY, x, y)
            prevX = x
            prevY = y
        }

        canvas.drawPath(path, paint)
    }

    /**
     * Render fountain pen strokes using the Onyx SDK's NeoFountainPenWrapper.
     * Delegates to OnyxHelper to keep SDK type references isolated.
     * Falls back to constant-width rendering if the SDK is unavailable.
     */
    private fun renderFountainToBitmap(points: List<FloatArray>, paint: Paint) {
        val canvas = bitmapCanvas ?: return
        try {
            OnyxHelper.renderFountainPen(canvas, paint, points, paint.strokeWidth)
        } catch (_: Throwable) {
            // SDK unavailable (non-Boox device) — fall back to constant-width path
            val path = Path()
            var prevX = points[0][0]
            var prevY = points[0][1]
            path.moveTo(prevX, prevY)
            for (i in 1 until points.size) {
                val x = points[i][0]
                val y = points[i][1]
                if (abs(prevY - y) >= 30 && abs(prevX - x) < 2) continue
                path.quadTo(prevX, prevY, x, y)
                prevX = x
                prevY = y
            }
            canvas.drawPath(path, paint)
        }
    }

    private fun refreshAfterStroke() {
        // Don't toggle raw drawing here — that causes a delay on the next
        // pen-down because the SDK needs to re-enter raw mode. Instead, stay
        // in raw drawing mode continuously. The SDK renders the live preview;
        // we just silently update our bitmap for persistence.
        //
        // The bitmap is NOT blitted to the SurfaceView here because the screen
        // is frozen in raw mode anyway. It will be shown when raw drawing is
        // explicitly disabled (e.g., navigating away, clear).

        // For fountain pen: render the complete stroke now that all points are
        // accumulated. Per-batch rendering was skipped in handleStrokePoints()
        // because NeoFountainPenWrapper's pressure smoothing algorithm produces
        // different results for partial vs complete point lists.
        // DEBUG: log stroke info before rendering
        val pressureSample = currentStrokePoints.take(5).joinToString { String.format("%.4f", it[2]) }
        android.util.Log.d("DrawingCanvas", "refreshAfterStroke: style=$currentStrokeStyle, ${currentStrokePoints.size} pts, width=${strokePaint.strokeWidth}, first pressures=[$pressureSample]")
        if (currentStrokeStyle == "fountain") {
            renderPointsToBitmap(currentStrokePoints, strokePaint, "fountain")
        }

        // Serialize accumulated stroke points as "x,y,p;x,y,p;..." packed string
        val pointsString = serializePoints(currentStrokePoints)

        // Retain stroke data for eraser hit-testing
        val strokeData = StrokeData(
            points = currentStrokePoints.map { it.copyOf() },
            color = strokePaint.color,
            width = strokePaint.strokeWidth,
            style = currentStrokeStyle,
            bounds = computeBounds(currentStrokePoints),
        )
        strokes.add(strokeData)

        currentStrokePoints.clear()

        onStrokeEnd(mapOf(
            "pathCount" to strokeCount,
            "points" to pointsString,
            "color" to String.format("#%06X", 0xFFFFFF and strokePaint.color),
            "width" to strokePaint.strokeWidth,
            "style" to currentStrokeStyle,
        ))
    }

    // ── Eraser ─────────────────────────────────────────────────────

    private fun handleEraserPoints(points: List<FloatArray>) {
        if (points.isEmpty()) return
        currentEraserPoints.addAll(points)
    }

    /**
     * Called when the stylus eraser button is released.
     * Hit-tests the eraser path against stored strokes, removes matches,
     * redraws the bitmap (background + remaining strokes), and fires
     * onEraseEnd to JS with the indices of erased strokes.
     */
    private fun handleEraseEnd() {
        val eraserPath = currentEraserPoints.toList()
        currentEraserPoints.clear()

        if (eraserPath.isEmpty() || strokes.isEmpty()) return

        val erasedIndices = findErasedStrokeIndices(eraserPath)
        if (erasedIndices.isEmpty()) return

        // Remove erased strokes in reverse order to keep indices valid
        for (index in erasedIndices) {
            strokes.removeAt(index)
        }
        strokeCount = strokes.size

        // Redraw: background + remaining strokes
        redrawBitmap()
        forceScreenRefresh()

        // Report erased indices to JS (already sorted descending)
        onEraseEnd(mapOf(
            "indices" to erasedIndices,
        ))
    }

    /**
     * Hit-test eraser path against stored strokes.
     * Uses Notable's proven algorithm:
     * 1. Build a Path from eraser points
     * 2. Expand it by 30px using Paint.getFillPath (eraser corridor)
     * 3. Convert to Region for point-in-path testing
     * 4. Phase 1: bounding box prefilter
     * 5. Phase 2: check if any stroke point falls inside the eraser region
     *
     * @return indices of erased strokes, sorted descending for safe removal.
     */
    private fun findErasedStrokeIndices(eraserPoints: List<FloatArray>): List<Int> {
        // Build the eraser path
        val rawPath = Path()
        rawPath.moveTo(eraserPoints[0][0], eraserPoints[0][1])
        for (i in 1 until eraserPoints.size) {
            rawPath.lineTo(eraserPoints[i][0], eraserPoints[i][1])
        }

        // Expand into a 30px-wide corridor
        val expandedPath = Path()
        eraserExpansionPaint.getFillPath(rawPath, expandedPath)

        // Compute eraser bounds for prefiltering
        val eraserBounds = RectF()
        expandedPath.computeBounds(eraserBounds, true)
        if (eraserBounds.isEmpty) return emptyList()

        // Convert to Region for efficient point-in-path testing.
        // Region uses integer coordinates, so we work in the canvas
        // coordinate space directly (pixels).
        val clipRect = Rect(
            eraserBounds.left.toInt(),
            eraserBounds.top.toInt(),
            eraserBounds.right.toInt() + 1,
            eraserBounds.bottom.toInt() + 1,
        )
        val eraserRegion = Region()
        eraserRegion.setPath(expandedPath, Region(clipRect))

        val result = mutableListOf<Int>()
        for (i in strokes.indices) {
            val stroke = strokes[i]

            // Phase 1: bounding box prefilter
            if (!RectF.intersects(stroke.bounds, eraserBounds)) continue

            // Phase 2: check if any point falls inside the eraser region
            val hit = stroke.points.any { point ->
                eraserRegion.contains(point[0].toInt(), point[1].toInt())
            }
            if (hit) {
                result.add(i)
            }
        }

        // Sort descending for safe removal / splice
        result.sortDescending()
        return result
    }

    /**
     * Redraw the entire bitmap from scratch: background + all retained strokes.
     * Used after eraser removes strokes.
     */
    private fun redrawBitmap() {
        val canvas = bitmapCanvas ?: return
        val bmp = bitmap ?: return
        drawBackground(canvas, bmp.width, bmp.height)

        val paint = Paint().apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
            isAntiAlias = true
        }

        for (stroke in strokes) {
            paint.color = stroke.color
            paint.strokeWidth = stroke.width
            renderPointsToBitmap(stroke.points, paint, stroke.style)
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /** Compute the bounding box of a list of [x, y, pressure] points. */
    private fun computeBounds(points: List<FloatArray>): RectF {
        if (points.isEmpty()) return RectF()
        var minX = Float.MAX_VALUE
        var minY = Float.MAX_VALUE
        var maxX = Float.MIN_VALUE
        var maxY = Float.MIN_VALUE
        for (p in points) {
            minX = min(minX, p[0])
            minY = min(minY, p[1])
            maxX = max(maxX, p[0])
            maxY = max(maxY, p[1])
        }
        return RectF(minX, minY, maxX, maxY)
    }

    /**
     * Serialize a list of [x, y, pressure, timestamp] points to a packed string.
     * Format: "x,y,p,t;x,y,p,t;..." — integers for x/y/t, 2 decimal places for pressure.
     *
     * The same format is implemented in TypeScript for the JS side:
     * @see features/notes/points.ts — encodePoints/decodePoints
     */
    private fun serializePoints(points: List<FloatArray>): String {
        val sb = StringBuilder(points.size * 16) // rough capacity estimate
        for (i in points.indices) {
            if (i > 0) sb.append(';')
            val p = points[i]
            sb.append(p[0].toInt())  // x
            sb.append(',')
            sb.append(p[1].toInt())  // y
            sb.append(',')
            sb.append(String.format("%.2f", p[2]))  // pressure
            sb.append(',')
            sb.append(p[3].toLong())  // timestamp
        }
        return sb.toString()
    }

    /**
     * Force a screen refresh by toggling raw drawing mode.
     * Used after clear() or when leaving the canvas.
     */
    private fun forceScreenRefresh() {
        drawBitmapToSurface()
        try {
            (onyxHelper as? OnyxHelper)?.toggleRawDrawing()
        } catch (e: Throwable) {
            android.util.Log.w("DrawingCanvas", "Error toggling raw drawing: ${e.message}")
        }
    }

    private fun drawBitmapToSurface() {
        val bmp = bitmap ?: return
        val holder = surfaceView.holder
        val canvas = holder.lockCanvas() ?: return
        try {
            canvas.drawBitmap(bmp, 0f, 0f, bitmapPaint)
        } finally {
            holder.unlockCanvasAndPost(canvas)
        }
    }

    private fun closeTouchHelper() {
        try {
            (onyxHelper as? OnyxHelper)?.close()
        } catch (_: Throwable) {}
        onyxHelper = null
    }

    /**
     * Deserialize a packed point string back to a list of [x, y, pressure, timestamp].
     * Inverse of serializePoints. Returns empty list for empty/invalid input.
     */
    private fun deserializePoints(packed: String): List<FloatArray> {
        if (packed.isEmpty()) return emptyList()
        return packed.split(';').mapNotNull { segment ->
            val parts = segment.split(',')
            if (parts.size < 4) null
            else floatArrayOf(
                parts[0].toFloat(),
                parts[1].toFloat(),
                parts[2].toFloat(),
                parts[3].toFloat()
            )
        }
    }

    // ── Public API ─────────────────────────────────────────────────

    /**
     * Set the background pattern. Called by the Expo Modules prop setter.
     * Supported values: "blank" (plain white), "dotted" (dot grid).
     */
    fun setBackgroundPattern(pattern: String) {
        if (backgroundPattern == pattern) return
        backgroundPattern = pattern

        // Redraw if bitmap already exists (prop change after surface created)
        if (bitmapCanvas != null) {
            redrawBitmap()
            forceScreenRefresh()
        }
    }

    /**
     * Set the stroke style. Called by the Expo Modules prop setter.
     * Supported values: "pencil", "fountain", "marker".
     */
    fun setStrokeStyleProp(style: String) {
        if (currentStrokeStyle == style) return
        currentStrokeStyle = style
        try {
            (onyxHelper as? OnyxHelper)?.updateStrokeStyle(OnyxHelper.styleStringToInt(style))
        } catch (_: Throwable) {}
    }

    /**
     * Set the stroke color. Called by the Expo Modules prop setter.
     * @param colorStr hex color string like "#FF0000".
     */
    fun setStrokeColorProp(colorStr: String) {
        val parsedColor = try { Color.parseColor(colorStr) } catch (_: Throwable) { Color.BLACK }
        if (currentStrokeColor == parsedColor) return
        currentStrokeColor = parsedColor
        strokePaint.color = parsedColor
        try {
            (onyxHelper as? OnyxHelper)?.updateStrokeColor(parsedColor)
        } catch (_: Throwable) {}
    }

    /**
     * Set the stroke width. Called by the Expo Modules prop setter.
     */
    fun setStrokeWidthProp(width: Float) {
        if (currentStrokeWidth == width) return
        currentStrokeWidth = width
        strokePaint.strokeWidth = width
        try {
            (onyxHelper as? OnyxHelper)?.updateStrokeWidth(width)
        } catch (_: Throwable) {}
    }

    /**
     * Set the exclude rects — areas where the SDK should not capture pen input.
     * Called by the Expo Modules prop setter.
     *
     * Each rect is a map with "x", "y", "width", "height" as Numbers.
     */
    fun setExcludeRectsProp(rects: List<Map<String, Any>>) {
        val nativeRects = rects.mapNotNull { map ->
            val x = (map["x"] as? Number)?.toInt() ?: return@mapNotNull null
            val y = (map["y"] as? Number)?.toInt() ?: return@mapNotNull null
            val w = (map["width"] as? Number)?.toInt() ?: return@mapNotNull null
            val h = (map["height"] as? Number)?.toInt() ?: return@mapNotNull null
            Rect(x, y, x + w, y + h)
        }
        try {
            (onyxHelper as? OnyxHelper)?.updateExcludeRects(nativeRects)
        } catch (_: Throwable) {}
    }

    /**
     * Load strokes from serialized data and render them to the bitmap.
     * Used for the resume flow: load SVG → parse data-points → loadStrokes.
     *
     * Each stroke is a map with:
     * - "points": packed point string ("x,y,p;x,y,p;...")
     * - "color": hex color string ("#000000")
     * - "width": stroke width as number
     *
     * Clears the canvas first, then renders all strokes, then refreshes the screen.
     */
    fun loadStrokes(strokeMaps: List<Map<String, Any>>) {
        val canvas = bitmapCanvas ?: return
        val bmp = bitmap ?: return
        android.util.Log.d("DrawingCanvas", "loadStrokes: ${strokeMaps.size} strokes to load")
        drawBackground(canvas, bmp.width, bmp.height)

        // Clear and rebuild the retained stroke list
        strokes.clear()

        val paint = Paint().apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
            isAntiAlias = true
        }

        for ((idx, strokeMap) in strokeMaps.withIndex()) {
            val pointsStr = strokeMap["points"] as? String ?: continue
            val colorStr = strokeMap["color"] as? String ?: "#000000"
            val widthVal = strokeMap["width"]
            val styleStr = strokeMap["style"] as? String ?: "pencil"

            val parsedColor = try {
                Color.parseColor(colorStr)
            } catch (_: Throwable) {
                Color.BLACK
            }
            val parsedWidth = when (widthVal) {
                is Number -> widthVal.toFloat()
                else -> 3f
            }

            paint.color = parsedColor
            paint.strokeWidth = parsedWidth

            val points = deserializePoints(pointsStr)
            if (points.isNotEmpty()) {
                // DEBUG: log fountain stroke pressure values on reload
                if (styleStr == "fountain") {
                    val pressureSample = points.take(3).joinToString { String.format("%.4f", it[2]) }
                    android.util.Log.d("DrawingCanvas", "loadStrokes[$idx]: fountain, width=$parsedWidth, ${points.size} pts, first pressures=[$pressureSample]")
                }
                renderPointsToBitmap(points, paint, styleStr)

                // Retain for eraser hit-testing
                strokes.add(StrokeData(
                    points = points,
                    color = parsedColor,
                    width = parsedWidth,
                    style = styleStr,
                    bounds = computeBounds(points),
                ))
            }
        }

        strokeCount = strokes.size
        // Just blit to surface — raw drawing is not active yet at this point.
        // The JS-side machine calls startDrawing() after this completes.
        drawBitmapToSurface()
    }

    fun clear() {
        val canvas = bitmapCanvas ?: return
        val bmp = bitmap ?: return
        drawBackground(canvas, bmp.width, bmp.height)
        strokeCount = 0
        strokes.clear()
        currentStrokePoints.clear()
        currentEraserPoints.clear()
        forceScreenRefresh()
    }

    fun cleanup() {
        closeTouchHelper()
        strokes.clear()
        bitmap?.recycle()
        bitmap = null
        bitmapCanvas = null
    }
}
