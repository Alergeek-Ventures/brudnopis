# Building a high-performance drawing canvas for Onyx Boox in React Native

**The key to low-latency pen input on Boox e-ink devices is Onyx's proprietary `onyxsdk-pen` library**, specifically the `TouchHelper.openRawDrawing()` API, which bypasses the entire Android rendering pipeline to write strokes directly to the e-ink display hardware. Without it, third-party apps suffer **200–300ms visible latency** — essentially unusable for handwriting. The good news: this native drawing engine can be wrapped as a React Native Native UI Component, letting you keep your app UI in React Native while the canvas portion runs at full native speed. Several open-source Boox note-taking apps already prove this SDK approach works, and a well-maintained RN sketch canvas library provides the bridging scaffolding you need.

---

## The Onyx Boox SDK is your non-negotiable foundation

Onyx International publishes its SDK as Maven packages hosted at `repo.boox.com/repository/maven-public/` under the group `com.onyx.android.sdk`. The two essential packages are:

- **`onyxsdk-pen` (v1.2.1+, updated Feb 2026)** — Provides `TouchHelper` and `RawInputCallback`, the critical APIs for zero-latency stylus drawing
- **`onyxsdk-device` (v1.1.11)** — Provides `EpdController` for managing e-ink refresh modes

```gradle
// build.gradle (app)
implementation('com.onyx.android.sdk:onyxsdk-device:1.1.11')
implementation('com.onyx.android.sdk:onyxsdk-pen:1.2.1')

// build.gradle (project) repositories
maven { url "https://jitpack.io" }
maven { url "http://repo.boox.com/repository/maven-public/" }
```

The official demo repository at [onyx-intl/OnyxAndroidDemo](https://github.com/onyx-intl/OnyxAndroidDemo) (207 stars) is the primary developer resource. Onyx has **no dedicated developer portal** — documentation lives in the repo's `/doc/` folder (`Onyx-Pen-SDK.md`, `EpdController.md`, `Eink-Develop-Guide.md`) and in their [public-wiki](https://github.com/onyx-intl/public-wiki) repository.

### How TouchHelper achieves near-zero latency

When you call `touchHelper.openRawDrawing()`, something remarkable happens: the screen **freezes** for normal Android rendering, and the Onyx pen service captures stylus input directly at the hardware level. Strokes are rendered to the e-ink display using **DW (Direct Waveform) mode** at ~200ms update speed — bypassing the Android view system, compositor, and standard EPD refresh cycle entirely. This is why Boox's built-in Notes app feels instantaneous while standard Android drawing apps feel sluggish.

The core workflow is straightforward:

```java
// 1. Create TouchHelper bound to your view
TouchHelper touchHelper = TouchHelper.create(surfaceView, rawInputCallback)
    .setStrokeWidth(3.0f)
    .setLimitRect(drawableRect, excludeRects);

// 2. Enter raw drawing mode (freezes screen, captures pen at hardware level)
touchHelper.openRawDrawing();
touchHelper.setRawDrawingEnabled(true);

// 3. When done (e.g., switching to UI interaction)
touchHelper.setRawDrawingEnabled(false);
touchHelper.closeRawDrawing();  // unfreezes screen, resumes normal refresh
```

The `RawInputCallback` interface delivers `TouchPoint` objects (x, y, pressure) through methods like `onBeginRawDrawing`, `onRawDrawingTouchPointMoveReceived`, and `onEndRawDrawing` — plus separate eraser callbacks (`onBeginRawErasing`, etc.) triggered by the stylus side button. Boox devices use a **Wacom EMR digitizer** with **4,096 pressure levels** and tilt sensitivity, all accessible through this callback.

A critical detail from the SDK docs: **"Any type of view can be a drawing target, e.g. a SurfaceView or a WebView."** This is directly relevant to React Native integration, since your bridged native view can serve as the TouchHelper target.

---

## E-ink refresh modes and the drawing optimization playbook

E-ink displays use waveforms — electrical pulse sequences — to transition pixels between states. Understanding these modes is essential for building a drawing app that feels responsive:

| Mode | Speed | Grayscale | Use case |
|------|-------|-----------|----------|
| **A2** | Fastest (~120ms) | 2-level B/W only | Active pen drawing, animations |
| **DU** | Very fast | 2-level B/W | Quick monochrome updates |
| **DW** | ~200ms | Acceptable | Boox SDK's scribble mode (best balance) |
| **GU/GU_FAST** | ~600ms | 16-level | Normal UI rendering |
| **GC16** | Slowest | Full 16-level | Highest quality, full refresh (flashes) |

Drawing apps use a **multi-mode strategy**: during active pen input, use A2/DU/DW mode for the stroke region (partial update) for instant visual feedback. After the pen lifts, wait a configurable delay (typically 300–400ms), then trigger a GC16 partial refresh of the dirty region to render the stroke at full quality and reduce ghosting. Periodically, a full-screen GC16 refresh clears accumulated ghosting.

The `EpdController` API exposes this control:

```java
// During active drawing — fast mode
EpdController.setViewDefaultUpdateMode(drawingView, EpdController.UpdateMode.DW);

// After pen-up — high quality refresh
EpdController.setViewDefaultUpdateMode(drawingView, EpdController.UpdateMode.GC);
```

Beyond refresh modes, several rendering techniques matter for e-ink performance. **Disable hardware acceleration** on your drawing view (`setLayerType(View.LAYER_TYPE_SOFTWARE, null)`) — GPU rendering adds overhead designed for 60fps LCDs that's wasted on e-ink. Use **dirty rectangle tracking** aggressively; e-ink refresh time scales with update area, so minimizing the refresh region is critical. Maintain an **offscreen bitmap as a back buffer** for completed strokes, and only draw the active (in-progress) stroke dynamically. Process `MotionEvent.getHistoricalX/Y()` to capture intermediate touch points for smoother curves, and use **cubic Bezier interpolation** with velocity-based width variation for natural-looking strokes.

---

## Bridging the native canvas into React Native

The architecture is clear: **build the drawing canvas as a native Android View, wrap it via React Native's Native UI Component system, and keep everything else in React Native.** The critical insight is that touch events dispatched to a native Android View **never pass through the RN bridge** — `onTouchEvent()` runs on the Android UI thread with the full `MotionEvent` data (pressure, tilt, tool type), identical to a purely native app.

### The ViewManager approach

For the legacy architecture (still widely supported), extend `SimpleViewManager<DrawingCanvasView>`:

```java
public class DrawingCanvasManager extends SimpleViewManager<DrawingCanvasView> {
    public static final String REACT_CLASS = "RCTDrawingCanvas";

    @Override
    public String getName() { return REACT_CLASS; }

    @Override
    public DrawingCanvasView createViewInstance(ThemedReactContext context) {
        return new DrawingCanvasView(context);
    }

    @ReactProp(name = "strokeWidth", defaultFloat = 3f)
    public void setStrokeWidth(DrawingCanvasView view, float width) {
        view.setStrokeWidth(width);
    }

    // Commands: clear, undo, redo, changeTool
    @Override
    public Map<String, Integer> getCommandsMap() {
        return MapBuilder.of("clear", 1, "undo", 2, "redo", 3);
    }

    @Override
    public void receiveCommand(DrawingCanvasView view, int cmd, ReadableArray args) {
        switch (cmd) {
            case 1: view.clear(); break;
            case 2: view.undo(); break;
            case 3: view.redo(); break;
        }
    }
}
```

On the JavaScript side, wrap with `requireNativeComponent` and expose imperative commands via `useImperativeHandle`:

```tsx
const NativeCanvas = requireNativeComponent('RCTDrawingCanvas');

const DrawingCanvas = forwardRef((props, ref) => {
    const canvasRef = useRef(null);
    useImperativeHandle(ref, () => ({
        clear: () => UIManager.dispatchViewManagerCommand(
            findNodeHandle(canvasRef.current),
            UIManager.getViewManagerConfig('RCTDrawingCanvas').Commands.clear, []
        ),
        undo: () => /* similar */,
    }));
    return <NativeCanvas ref={canvasRef} {...props} />;
});
```

### Preventing React Native from stealing touch events

This is the single most important implementation detail for the bridge. Override `onTouchEvent` in your `DrawingCanvasView` and call `requestDisallowInterceptTouchEvent(true)` on every `ACTION_DOWN`:

```java
@Override
public boolean onTouchEvent(MotionEvent event) {
    if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
        getParent().requestDisallowInterceptTouchEvent(true);
    }
    // Process stroke with full pressure/tilt data...
    return true;
}
```

This sets `FLAG_DISALLOW_INTERCEPT` on all ancestor `ViewGroup`s, preventing React Native's gesture responder system, ScrollViews, and `react-native-gesture-handler` from intercepting events meant for the canvas. Android resets this flag on each new gesture, so you must call it on every `ACTION_DOWN`.

### Communication patterns

Keep the bridge minimal. **Never send per-point data across the bridge during active drawing** — all stroke processing and rendering happens natively. Only send high-level events to JavaScript: stroke completion (with serialized path data), page changes, or undo stack state. Send commands from JS to native for clear, undo/redo, tool changes, and export. For Fabric (new architecture), use `codegenNativeComponent` with TypeScript specs and `codegenNativeCommands` for type-safe commands — this eliminates JSON serialization overhead via JSI.

---

## Notable and other open-source starting points

The open-source ecosystem for Boox drawing apps is small but highly relevant:

**[Notable](https://github.com/Ethran/notable)** (originally olup/notable, now maintained by Ethran) is the most important reference project. It's a **100% Kotlin native Android** note-taking app built specifically for Boox devices, using `onyxsdk-pen` and `onyxsdk-device` for native raw rendering. Drawing smoothness matches Boox's built-in Notes app. Features include infinite vertical scroll, notebooks/folders, gesture controls (double-tap undo, two-finger eraser toggle), selection/copy/move, and PDF backgrounds. Licensed GPL-3.0 with an active community and Discord. The original repo (297 stars) was archived in 2023; the Ethran fork is actively maintained. **Its drawing engine is fully open source but not extractable as a standalone library** — it's tightly integrated into the app's Kotlin codebase, though the SDK integration patterns are directly replicable.

**[PngNote](https://github.com/karino2/PngNote)** (70 stars, MIT license) is a more minimal Boox note app also using the SDK's raw-rendering mode. Its simple Kotlin codebase makes it an excellent reference for understanding the essential BOOX drawing APIs without the complexity of a full-featured app. Stores notes as numbered PNG files.

**[boox-rapid-draw](https://github.com/sergeylappo/boox-rapid-draw)** (212 stars, MIT) takes a different approach: it creates a transparent Android overlay on top of any app and uses the Onyx Pen SDK to capture pen input and render strokes on the overlay. This achieves near-zero latency drawing over arbitrary applications — an interesting technique that demonstrates the SDK's flexibility.

For the React Native canvas portion, **[@sourcetoad/react-native-sketch-canvas](https://opensource.sourcetoad.com/docs/react-native-packages/react-native-sketch-canvas/)** (MIT, actively maintained) is the strongest starting point. It's a TypeScript rewrite of the original `react-native-sketch-canvas` with **Fabric/TurboModules support** for React Native's new architecture. It uses native Android `Canvas` for rendering with touch events handled entirely on the native side — the exact pattern you need. You would fork this and replace its standard canvas drawing with the OnyxSDK `TouchHelper` integration.

**Saber** (Flutter, GPL-3.0) is a popular cross-platform handwriting app, but user reviews confirm it's "almost comically slow on Onyx and probably all e-ink devices." Flutter's rendering pipeline adds overhead that e-ink handles poorly, validating the native-canvas-for-drawing approach.

---

## Recommended architecture and implementation plan

The optimal architecture combines React Native for app chrome (navigation, file management, settings, sync) with a native Android module for the drawing surface:

```
┌─────────────────────────────────────────────────┐
│  React Native (TypeScript)                       │
│  • Navigation, file browser, settings            │
│  • Toolbar (pen/eraser/undo/redo buttons)        │
│  • Sync, export, notebook management             │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │  <DrawingCanvas>  (Native UI Component)      │ │
│  │                                               │ │
│  │  DrawingCanvasView (Kotlin, extends View)    │ │
│  │  ├─ TouchHelper + RawInputCallback           │ │
│  │  │  (onyxsdk-pen: raw drawing mode)          │ │
│  │  ├─ EpdController (refresh mode switching)   │ │
│  │  ├─ Offscreen Bitmap (completed strokes)     │ │
│  │  ├─ Undo/redo stack (native)                 │ │
│  │  └─ requestDisallowInterceptTouchEvent       │ │
│  │                                               │ │
│  │  Props: strokeWidth, toolType, pageData      │ │
│  │  Commands: clear, undo, redo, changeTool     │ │
│  │  Events: onStrokeCompleted, onPageChanged    │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

The implementation sequence should be:

**Phase 1 — Native drawing module.** Start by building a standalone Android `DrawingCanvasView` in Kotlin that integrates `TouchHelper` and `EpdController`. Use PngNote and Notable as reference implementations. Get raw drawing working with stroke capture, pressure-sensitive rendering, and proper refresh mode management. Test on your Boox device to verify latency.

**Phase 2 — React Native bridge.** Wrap the view in a `SimpleViewManager`, register it as a Native UI Component, and expose props (strokeWidth, toolType) and commands (clear, undo, redo). Use `@sourcetoad/react-native-sketch-canvas`'s bridge architecture as scaffolding. Ensure touch events reach the native view uninterrupted via `requestDisallowInterceptTouchEvent`.

**Phase 3 — App shell.** Build the React Native UI around the native canvas: notebook/page management, toolbar, file browser, settings. Keep stroke data serialization on the native side; only cross the bridge for completed strokes and high-level state.

**Phase 4 — Graceful degradation.** For non-Boox devices, fall back to standard Android `Canvas` drawing without the OnyxSDK — the same `DrawingCanvasView` can detect whether `TouchHelper` is available and degrade to standard `onTouchEvent` + `invalidate()` rendering. This mirrors how the Flutter `onyxsdk_pen` package handles non-Onyx devices.

One caveat worth noting: the `onyxsdk-pen` library does not currently support **16KB page sizes**, which Google Play has required since November 2025. If you plan to distribute via Google Play, you'll need to monitor Onyx's SDK updates for a fix, or distribute via GitHub/F-Droid instead.

## Conclusion

The path to a high-quality Boox drawing experience in React Native is well-charted, even if no one has built this exact combination before. The `onyxsdk-pen` TouchHelper API is the proven, essential ingredient — every app that achieves good pen latency on Boox uses it. React Native's Native UI Component system is architecturally ideal for this use case because touch events bypass the JS bridge entirely, giving you native-level input performance. The combination of Notable/PngNote (for SDK integration patterns) and `@sourcetoad/react-native-sketch-canvas` (for RN bridging patterns) provides concrete, production-tested code to build from. The main risk is Onyx's limited developer support and occasional SDK quirks across device models, but the active community around Notable and boox-rapid-draw provides a knowledge base to navigate these issues.