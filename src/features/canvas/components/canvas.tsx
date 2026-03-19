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
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, type LayoutChangeEvent, Text, View } from 'react-native';
import { withUniwind } from 'uniwind';

import { noteLifecycleMachineAtom } from '@/features/recognition/atoms';
import { activeLanguageAtom } from '@/features/settings/atoms';
import type { Stroke, StrokeStyle } from '@/features/svg/types';

import { Toolbar, type ToolbarState } from './toolbar';

// withUniwind auto-mode intercepts any prop whose name ends with "Style" and
// wraps it in a style-merge array, which breaks native string props like
// penType. Manual mode only maps the props we explicitly list; everything
// else (penType, strokeColor, strokeWidth, event handlers, ref) passes through.
const DrawingCanvasView = withUniwind(NativeDrawingCanvasView, {
  style: { fromClassName: 'className' },
});

// Default canvas dimensions — matches typical Boox screen.
const CANVAS_WIDTH = 1872;
const CANVAS_HEIGHT = 2404;
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

  // Toolbar state — tracks current tool, stroke style/color/width.
  const [toolbarState, setToolbarState] = useState<ToolbarState>({
    tool: 'pencil',
    strokeStyle: 'pencil',
    strokeColor: '#000000',
    strokeWidth: 5,
  });

  const toolbarStateRef = useRef(toolbarState);
  toolbarStateRef.current = toolbarState;

  // Block hardware back button while canvas is open.
  // Subscribes once on first render. The subscription is cleaned up by the
  // CLOSE_NOTE flow which navigates away (unmounting this component).
  const backHandlerSetUp = useRef(false);
  if (!backHandlerSetUp.current) {
    backHandlerSetUp.current = true;
    BackHandler.addEventListener('hardwareBackPress', () => true);
  }

  // Send OPEN_NOTE synchronously during render (not in an effect).
  // The machine is idempotent for same fileUri/folderUri — safe to call on re-renders.
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
      const state = toolbarStateRef.current;
      send({
        type: 'STROKE_END',
        points: event.nativeEvent.points,
        color: event.nativeEvent.color,
        width: event.nativeEvent.width,
        style: state.strokeStyle as StrokeStyle,
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

  const handleToolbarChange = useCallback((state: ToolbarState) => {
    setToolbarState(state);
  }, []);

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

  // Pass pen settings to the native canvas.
  const penType = toolbarState.tool === 'eraser' ? undefined : toolbarState.strokeStyle;
  const strokeColor = toolbarState.tool === 'eraser' ? undefined : toolbarState.strokeColor;
  const strokeWidth = toolbarState.tool === 'eraser' ? undefined : toolbarState.strokeWidth;

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
          onChange={handleToolbarChange}
          onExpandedChange={handleToolbarExpandedChange}
          onLayout={handleToolbarLayout}
        />
      )}
    </View>
  );
}
