import type {
  DrawingCanvasRef,
  EraseEndEvent,
  ExcludeRect,
  ReadyEvent,
  StrokeEndEvent,
} from 'drawing-canvas';
import { DrawingCanvasView as NativeDrawingCanvasView } from 'drawing-canvas';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, type LayoutChangeEvent, Text, View } from 'react-native';
import { withUniwind } from 'uniwind';

import { DEFAULT_PEN_SETTINGS, penSettingsAtom } from '@/features/canvas/atoms/pen-settings';
import { noteLifecycleMachineAtom } from '@/features/recognition/atoms/note-lifecycle-machine';
import { activeLanguageAtom } from '@/features/settings/atoms/active-language';
import type { Stroke, StrokeStyle } from '@/features/svg/types';

import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/types/canvas';

import { Toolbar } from './toolbar';

// withUniwind auto-mode intercepts any prop whose name ends with "Style" and
// wraps it in a style-merge array, which breaks native string props like
// penType. Manual mode only maps the props we explicitly list; everything
// else (penType, strokeColor, strokeWidth, event handlers, ref) passes through.
const DrawingCanvasView = withUniwind(NativeDrawingCanvasView, {
  style: { fromClassName: 'className' },
});

const BACKGROUND_PATTERN = 'dotted' as const;

export function Canvas() {
  const { fileUri, folderUri } = useLocalSearchParams<{ fileUri?: string; folderUri?: string }>();

  if (!fileUri && !folderUri) {
    return <Redirect href="/" />;
  }

  return <CanvasContent fileUri={fileUri ?? null} folderUri={folderUri ?? null} />;
}

function CanvasContent({
  fileUri,
  folderUri,
}: {
  fileUri: string | null;
  folderUri: string | null;
}) {
  const canvasRef = useRef<DrawingCanvasRef>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeLanguage = useAtomValue(activeLanguageAtom);
  const [snapshot, send] = useAtom(noteLifecycleMachineAtom);

  // Show a loading overlay while the machine saves + refetches thumbnails.
  const isSaving = snapshot.matches('navigating');

  // Pen settings — the toolbar owns writes; canvas derives native props.
  const persisted = useAtomValue(penSettingsAtom);
  const {
    activeTool = DEFAULT_PEN_SETTINGS.activeTool,
    lastPenStyle = DEFAULT_PEN_SETTINGS.lastPenStyle,
    penSettings = DEFAULT_PEN_SETTINGS.penSettings,
  } = persisted ?? DEFAULT_PEN_SETTINGS;
  const currentStyle = activeTool === 'eraser' ? lastPenStyle : activeTool;
  const currentPen = penSettings[currentStyle];

  // Violation: useEffect for BackHandler subscription lifecycle.
  // Rationale: BackHandler requires addEventListener/remove pairing — no
  // declarative alternative exists in React Native.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, []);

  // Violation: Render-time side effect — sends OPEN_NOTE to XState during render.
  // Rationale: The machine is idempotent for same fileUri/folderUri. Sending during
  // render avoids a useEffect and ensures the machine is in the correct state before
  // the first paint. Acceptable because XState dispatch is synchronous and pure.
  const noteId = fileUri ?? folderUri;
  const openedRef = useRef<string | null>(null);
  if (openedRef.current !== noteId) {
    openedRef.current = noteId;
    send({
      type: 'OPEN_NOTE',
      fileUri,
      folderUri,
      lang: activeLanguage,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundPattern: BACKGROUND_PATTERN,
      strokesRef,
      canvasRef,
    });
  }

  // ── Event handlers (sent to XState, no effects) ──────────────

  const handleReady = useCallback(
    (_event: ReadyEvent) => {
      send({ type: 'CANVAS_READY' });
    },
    [send],
  );

  const handleStrokeEnd = useCallback(
    (event: StrokeEndEvent) => {
      send({
        type: 'STROKE_END',
        points: event.nativeEvent.points,
        color: event.nativeEvent.color,
        width: event.nativeEvent.width,
        style: (event.nativeEvent.style || 'pencil') as StrokeStyle,
      });
    },
    [send],
  );

  const handleEraseEnd = useCallback(
    (event: EraseEndEvent) => {
      send({
        type: 'ERASE_END',
        indices: event.nativeEvent.indices,
      });
    },
    [send],
  );

  const handleClose = useCallback(() => {
    send({ type: 'CLOSE_NOTE' });
  }, [send]);

  // ── Toolbar bounds → excludeRects ──────────────────────────
  // Tracks the toolbar's on-screen bounds so the Onyx SDK doesn't
  // capture stylus input over it. Updated via onLayout (no effects).

  const [toolbarRect, setToolbarRect] = useState<ExcludeRect | null>(null);

  const handleToolbarLayout = useCallback((event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    setToolbarRect({ x, y, width, height });
  }, []);

  const excludeRects = toolbarRect ? [toolbarRect] : undefined;

  // ── Toolbar expand / collapse → XState ─────────────────────
  // Pauses raw drawing when expanded (so color/width pickers get
  // touch events), resumes when collapsed.

  const handleToolbarExpandedChange = useCallback(
    (expanded: boolean) => {
      send({ type: expanded ? 'TOOLBAR_EXPANDED' : 'TOOLBAR_COLLAPSED' });
    },
    [send],
  );

  const penType = activeTool === 'eraser' ? undefined : currentStyle;
  const strokeColor = activeTool === 'eraser' ? undefined : currentPen.color;
  const strokeWidth = activeTool === 'eraser' ? undefined : currentPen.width;

  return (
    <View className="flex-1 bg-white">
      <DrawingCanvasView
        ref={canvasRef}
        className="flex-1"
        backgroundPattern={BACKGROUND_PATTERN}
        penType={penType}
        strokeColor={strokeColor}
        strokeWidth={strokeWidth}
        excludeRects={excludeRects}
        onReady={handleReady}
        onStrokeEnd={handleStrokeEnd}
        onEraseEnd={handleEraseEnd}
      />
      {/* Toolbar renders after canvas so it sits on top in Android's
          native view hierarchy. SurfaceView ignores CSS z-index. */}
      {isSaving ? (
        <View className="absolute inset-0 items-center justify-center bg-white/80">
          <ActivityIndicator size="large" color="#333" />
          <Text className="mt-3 text-base text-gray-600">Saving…</Text>
        </View>
      ) : (
        <Toolbar
          onClose={handleClose}
          onExpandedChange={handleToolbarExpandedChange}
          onLayout={handleToolbarLayout}
        />
      )}
    </View>
  );
}
