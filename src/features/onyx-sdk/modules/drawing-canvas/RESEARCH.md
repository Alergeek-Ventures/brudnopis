# Drawing Canvas Progress

## Current state

Expo SDK 55, React Native 0.83.2, New Architecture enabled (Fabric + Hermes).
App is a scaffold — placeholder Home/Explore tabs, no real features yet.
Running on a Boox e-ink tablet via dev server.

---

## What we learned about the Onyx SDK

### Core mechanism: TouchHelper + RawInputCallback

`onyxsdk-pen` (v1.2.1) provides `TouchHelper` — the only way to get low-latency
pen input on Boox devices. Without it, drawing has 200-300ms visible latency.

When `touchHelper.openRawDrawing()` is called, the screen **freezes** for normal
Android rendering. The SDK captures stylus input at the hardware level and renders
strokes directly to the e-ink framebuffer using DW (Direct Waveform) mode. This
bypasses Android's view system entirely.

The `RawInputCallback` delivers `TouchPoint` objects (x, y, pressure, timestamp)
through these methods:
- `onBeginRawDrawing` / `onEndRawDrawing` — pen down / pen up
- `onRawDrawingTouchPointMoveReceived` — individual points as pen moves
- `onRawDrawingTouchPointListReceived` — accumulated points for a complete stroke (primary data callback)
- Matching eraser callbacks: `onBeginRawErasing`, `onRawErasingTouchPointListReceived`, etc.

Boox devices use a Wacom EMR digitizer with 4096 pressure levels and tilt sensitivity,
all accessible through `TouchPoint`.

### Dual-render architecture

This is the key insight. The SDK renders a **live preview** and the app renders
the **persistent version**. They never overlap visually:

1. **While pen is down:** Screen is frozen for Android. SDK renders the stroke
   directly to e-ink hardware using the configured `setStrokeStyle()`. App
   receives `TouchPoint` data via callbacks but cannot update the screen.

2. **When pen lifts:** App draws the stroke to its own `Bitmap` using the
   collected points. Then unfreezes the screen (`setRawDrawingEnabled(false/true)`
   toggle), which shows the app's bitmap.

The SDK's live rendering is ephemeral — it exists only in the e-ink framebuffer,
not in any app-accessible canvas. So the app MUST render every stroke itself for
persistence and display.

### SDK pen styles (free live preview)

The SDK provides built-in stroke styles for the live preview:

| Constant | Style |
|---|---|
| `STROKE_STYLE_PENCIL` | Constant-width ballpoint |
| `STROKE_STYLE_FOUNTAIN` | Pressure-variable fountain pen |
| `STROKE_STYLE_NEO_BRUSH` | Pressure-sensitive soft brush |
| `STROKE_STYLE_MARKER` | Semi-transparent highlighter |
| `STROKE_STYLE_CHARCOAL` | Textured pencil/charcoal v1 |
| `STROKE_STYLE_CHARCOAL_V2` | Textured pencil/charcoal v2 |
| `StrokeStyle.DASH` | Dashed line |

Calling `touchHelper.setStrokeStyle(...)` changes the live preview style
instantly. These are free — no app code needed for the preview.

For the app-side bitmap rendering, the SDK provides helper classes that match
the preview styles: `NeoFountainPenV2`, `NeoBrushPen`, `NeoMarkerPen`,
`NeoCharcoalPenV2`. These take `TouchPoint` lists and render to a `Canvas`
with matching pressure/texture behavior. For simple ballpoint (`STROKE_STYLE_PENCIL`),
standard `Canvas.drawPath()` with `Path.quadTo()` is sufficient.

### Screen refresh pattern — stay in raw mode

**Critical UX finding:** Do NOT toggle `setRawDrawingEnabled(false/true)` after
every stroke. PngNote does this and it causes a visible delay on each pen-down
because the SDK needs to re-enter raw mode. For writing, these delays compound
and make every letter sluggish.

**Correct approach:** Keep raw drawing enabled continuously. The SDK renders the
live preview directly to e-ink; the app silently renders to its offscreen bitmap
for persistence. Only toggle raw drawing when explicitly needed (clear, navigate
away, toolbar interaction).

```kotlin
// DON'T do this after every stroke:
touchHelper.setRawDrawingEnabled(false)
touchHelper.setRawDrawingEnabled(true)

// DO: just update the bitmap silently, stay in raw mode
canvas.drawPath(path, strokePaint)  // bitmap only, screen stays frozen
```

Toggle raw drawing only for explicit operations:
```kotlin
fun forceScreenRefresh() {
    drawBitmapToSurface()           // blit bitmap to SurfaceView
    touchHelper.setRawDrawingEnabled(false)
    touchHelper.setRawDrawingEnabled(true)  // re-enter raw mode
}
```

### SDK dependencies — the hard-won setup

The Onyx SDK cannot be used as standard Maven dependencies due to multiple issues:
- AARs contain AndroidManifest entries (OnyxFileProvider) that crash the app on boot
- Transitive deps (commonsIO, mmkv) use wrong artifact names and can't be resolved
- The native library (`libonyx_pen_touch_reader.so`) is on the device at
  `/system/lib64/` but Android's linker namespace blocks loading it from there

**Solution: vendored JARs + bundled native library**

1. Download AARs from `http://repo.boox.com/repository/maven-public/` (HTTPS has TLS issues, use HTTP)
2. Extract `classes.jar` from each AAR — this gives us only the Java classes,
   no manifest, no resources, no transitive dependency problems
3. Pull `libonyx_pen_touch_reader.so` from the Boox device via `adb shell cat`
   and place in `jniLibs/arm64-v8a/` — bundled in the APK, loadable from the
   app's own lib path

Vendored SDK versions (matching Notable's proven config):
```
libs/
  onyxsdk-pen-1.5.1.jar        # TouchHelper, RawInputCallback
  onyxsdk-base-1.8.3.jar       # note.TouchPoint, higher-level SDK classes
  onyxsdk-baselite-1.1.0.1.jar # base.data.TouchPoint (superclass)
  onyxsdk-device-1.3.2.jar     # EpdController

jniLibs/arm64-v8a/
  libonyx_pen_touch_reader.so   # pulled from device, ~86KB
```

Additional runtime deps (from Maven Central, no issues):
```gradle
implementation 'io.reactivex.rxjava2:rxjava:2.2.21'     // SDK uses RxJava internally
implementation 'io.reactivex.rxjava2:rxandroid:2.1.1'
```

**Version mismatch is critical:** The `.so` on the device must match the SDK JAR
versions. Old JARs (1.2.1) crash because the native code calls methods that don't
exist in the old Java classes (e.g., `RawInputReader.onTouchPointReceived`).

**Class package changes between SDK versions:**
- Old: `com.onyx.android.sdk.pen.data.TouchPoint`
- New (1.5.1): `com.onyx.android.sdk.data.note.TouchPoint` (extends `com.onyx.android.sdk.base.data.TouchPoint`)
- `TouchPointList` stays at `com.onyx.android.sdk.pen.data.TouchPointList`
- `RawInputCallback` stays at `com.onyx.android.sdk.pen.RawInputCallback`

### Expo config plugin (`plugins/with-boox-sdk.js`)

Since `android/` is regenerated by `expo prebuild`, we use a config plugin to:
1. Add Boox Maven repo to `allprojects.repositories` in root `build.gradle`
2. Add `hiddenapibypass:6.1` dep to `app/build.gradle`
3. Call `HiddenApiBypass.addHiddenApiExemptions("")` in `MainApplication.onCreate()`
4. Add `<uses-native-library android:name="libonyx_pen_touch_reader.so" android:required="false"/>`

Note: the HiddenApiBypass alone doesn't fix the linker namespace issue (that's
fixed by bundling the .so), but it's needed by the SDK for other hidden API calls
on Android 11+. Notable and toolsboox-android both use it.

### OnyxHelper isolation pattern

All SDK type references are isolated in `OnyxHelper.kt`, separate from
`DrawingCanvasView.kt`. This is critical because:
- `RawInputCallback` is an **abstract class** (not an interface) — `Proxy.newProxyInstance()` cannot be used
- If SDK classes are in the view's class body, the JVM tries to resolve them at
  class load time, causing `NoClassDefFoundError` before our try/catch can run
- By putting SDK refs in a separate class loaded lazily inside a try/catch,
  `DrawingCanvasView` can exist on non-Boox devices

---

## What we learned about the React Native bridge

### Expo Modules API for native views

The native canvas will be a local Expo module in `modules/drawing-canvas/`.
Expo Modules API uses a Kotlin DSL:

- `View(ViewClass::class) { Prop(), Events(), AsyncFunction(), OnViewDestroys }` 
- View class must extend `ExpoView` (which extends `LinearLayout`)
- Since we need a `SurfaceView`, we use the **container pattern**: `ExpoView` holds
  a child `SurfaceView` — same pattern as `expo-camera`
- Set `shouldUseAndroidLayout = true` so React Native re-measures on `requestLayout()`
- Events use `EventDispatcher` delegate properties on the view class
- Imperative commands (`clear`, `undo`) use `AsyncFunction` inside `View {}` block
- `requireNativeViewManager('ModuleName')` on the JS side

Touch events on the native `SurfaceView` child run entirely on the Android UI thread.
They never cross the JS bridge. Only high-level events (`onStrokeEnd`) cross to JS.
`requestDisallowInterceptTouchEvent(true)` on `ACTION_DOWN` prevents RN gesture
system from stealing pen input.

### Module file structure

```
modules/drawing-canvas/
  expo-module.config.json
  index.ts
  src/
    DrawingCanvasView.tsx
    DrawingCanvas.types.ts
  android/
    build.gradle              # Onyx SDK deps + Maven repo
    src/main/java/expo/modules/drawingcanvas/
      DrawingCanvasModule.kt  # Module definition (DSL)
      DrawingCanvasView.kt    # ExpoView + SurfaceView + TouchHelper
```

---

## Reference implementations

### PngNote (minimal, ~350 lines)
- GitHub: https://github.com/karino2/PngNote
- Key file: `app/src/main/java/io/github/karino2/pngnote/ui/CanvasBoox.kt`
- SurfaceView + TouchHelper, one pen type (STROKE_STYLE_PENCIL), no pressure
- Renders with `Path.quadTo()`, undo via bitmap region snapshots
- Best starting template for our spike

### Notable (full-featured)
- GitHub: https://github.com/Ethran/notable (actively maintained fork)
- Key files:
  - `editor/canvas/OnyxInputHandler.kt` — TouchHelper setup + raw input
  - `editor/canvas/DrawCanvas.kt` — SurfaceView subclass
  - `editor/drawing/drawStroke.kt` — per-pen-type rendering
  - `editor/utils/pen.kt` — pen enum + `penToStroke()` mapping
- All SDK pen styles, pressure-sensitive rendering, zoom, infinite scroll
- Guards against non-Onyx devices (`if (DeviceCompat.isOnyxDevice)`)
- Uses SDK helper wrappers for bitmap rendering (NeoFountainPenV2Wrapper, etc.)

### OnyxAndroidDemo (official SDK demo)
- GitHub: https://github.com/onyx-intl/OnyxAndroidDemo
- Docs in `/doc/`: `Onyx-Pen-SDK.md`, `EpdController.md`, `Eink-Develop-Guide.md`
- `OnyxPenDemo` app demonstrates all 5 pen types with `ShapeFactory` mapping

### sourcetoad/react-native-sketch-canvas
- GitHub: https://github.com/sourcetoad/react-native-sketch-canvas
- Supports Fabric/New Architecture, Kotlin, v2.4.1
- Good reference for RN native view bridging pattern (ViewManager + events + commands)
- Does NOT use Onyx SDK — standard Android touch events only

---

## Architecture decision: component API

The native module stays minimal — only the canvas surface and drawing logic.
Everything else (toolbar, tool selection, colors) is React Native.

```tsx
<DrawingCanvas
  style={{ flex: 1 }}
  tool="pen"              // "pen" | "eraser"
  strokeColor="#000000"
  strokeWidth={3}
  onStrokeEnd={(e) => {
    // e.nativeEvent.pathCount
    // persist to disk later
  }}
  ref={canvasRef}         // canvasRef.clear(), canvasRef.undo()
/>
```

RN toolbar floats on top via absolute positioning. Props flow down for tool/color/width
changes. Events flow up for stroke completion. Imperative ref for clear/undo.

---

## Spike result: SUCCESS

**Pen input works with zero perceptible latency on the Boox Note Air 4C.**

Drawing is instant and continuous — no delay between strokes. The SDK renders
the live preview directly to e-ink while the app silently captures stroke data
to an offscreen bitmap.

Device tested: Boox Note Air 4C, firmware 4.1 (Android 13, API 33).

### What's working
- Full-screen native canvas via Expo Modules API
- Onyx SDK TouchHelper with raw drawing mode
- Continuous raw mode (no toggle between strokes)
- Stroke rendering to offscreen bitmap via `Path.quadTo()`
- `onStrokeEnd` event firing to JS
- Navigation: Home → Canvas (via Link) → Back

### Known issues
- Link/button hit area on e-ink is unreliable — target sizes need to be large
- No persistence — bitmap is lost on navigate away
- No undo/eraser/toolbar
- Only tested on arm64-v8a (Note Air 4C)

---

## Next steps

- Add tool/color/width props (map to SDK stroke styles + configure TouchHelper)
- Add undo (bitmap region snapshots, PngNote pattern)
- Add eraser (SDK has `onBeginRawErasing` callbacks)
- Add `onStrokeEnd` with serialized stroke data for persistence
- Float a React Native toolbar on top of the canvas
- Add graceful degradation for non-Boox devices (detect `TouchHelper` availability)
- Investigate SDK pen helper classes for pressure-sensitive bitmap rendering
  (NeoFountainPenV2, NeoBrushPen, etc.)
- Test on other Boox models — the `.so` may differ per device/firmware
