package expo.modules.drawingcanvas

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs

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

    val onStrokeEnd by EventDispatcher()

    private var bitmap: Bitmap? = null
    private var bitmapCanvas: Canvas? = null
    private var strokeCount: Int = 0

    private val strokePaint = Paint().apply {
        color = Color.BLACK
        strokeWidth = 3f
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        isAntiAlias = true
    }

    private val bitmapPaint = Paint()

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
            bitmapCanvas!!.drawColor(Color.WHITE)
            drawBitmapToSurface()

            initTouchHelper()
        }

        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            val oldBitmap = bitmap
            if (oldBitmap != null && (oldBitmap.width != width || oldBitmap.height != height)) {
                val newBitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                val newCanvas = Canvas(newBitmap)
                newCanvas.drawColor(Color.WHITE)
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

    // ── Onyx integration (all SDK access via OnyxHelper) ───────────

    private fun initTouchHelper() {
        try {
            val helper = OnyxHelper(
                surfaceView = surfaceView,
                onStrokeDrawn = { points -> handleStrokePoints(points) },
                onStrokeFinished = { refreshAfterStroke() },
            )
            helper.configure(strokePaint.strokeWidth, strokePaint.color, surfaceView.width, surfaceView.height)
            helper.openRawDrawing()
            onyxHelper = helper
            android.util.Log.i("DrawingCanvas", "OnyxHelper initialized successfully")
        } catch (e: NoClassDefFoundError) {
            android.util.Log.w("DrawingCanvas", "Onyx SDK not available: ${e.message}")
            onyxHelper = null
        } catch (e: Throwable) {
            android.util.Log.e("DrawingCanvas", "OnyxHelper init failed: ${e.javaClass.name}: ${e.message}")
            e.printStackTrace()
            onyxHelper = null
        }
    }

    private fun handleStrokePoints(points: List<FloatArray>) {
        val canvas = bitmapCanvas ?: return
        if (points.isEmpty()) return

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

        canvas.drawPath(path, strokePaint)
        strokeCount++
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
        onStrokeEnd(mapOf("pathCount" to strokeCount))
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

    // ── Public API ─────────────────────────────────────────────────

    fun clear() {
        bitmapCanvas?.drawColor(Color.WHITE)
        strokeCount = 0
        forceScreenRefresh()
    }

    fun cleanup() {
        closeTouchHelper()
        bitmap?.recycle()
        bitmap = null
        bitmapCanvas = null
    }
}
