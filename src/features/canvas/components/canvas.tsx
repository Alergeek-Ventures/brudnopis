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
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  type LayoutChangeEvent,
  Pressable,
  Text,
  View,
} from 'react-native';
import { withUniwind } from 'uniwind';

import { noteMachineAtom } from '@/features/canvas/atoms/note-machine';
import { DEFAULT_PEN_SETTINGS, penSettingsAtom } from '@/features/canvas/atoms/pen-settings';
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
  const [toolbarExpanded, setToolbarExpanded] = useState(false);
  const [snapshot, send] = useAtom(noteMachineAtom);

  // Show "Saving…" overlay once the note is closing. Derived directly from
  // the machine state — no child actor indirection needed.
  const isSavingRequested = snapshot.matches('saving') && snapshot.context.pendingIntent !== null;
  const isClosing =
    isSavingRequested ||
    snapshot.matches('reset') ||
    snapshot.matches('stopping') ||
    snapshot.matches('navigating');

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
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setToolbarExpanded(false);
      send({ type: 'CLOSE_NOTE' });
      return true;
    });
    return () => subscription.remove();
  }, [send]);

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
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundPattern: BACKGROUND_PATTERN,
      strokesRef,
      canvasRef,
    });
  }

  // ── Event handlers (sent to XState, no effects) ──────────────

  const handleReady = (_event: ReadyEvent) => {
    send({ type: 'CANVAS_READY' });
  };

  const handleStrokeEnd = (event: StrokeEndEvent) => {
    send({
      type: 'STROKE_END',
      points: event.nativeEvent.points,
      color: event.nativeEvent.color,
      width: event.nativeEvent.width,
      style: (event.nativeEvent.style || 'pencil') as StrokeStyle,
    });
  };

  const handleEraseEnd = (event: EraseEndEvent) => {
    send({
      type: 'ERASE_END',
      indices: event.nativeEvent.indices,
    });
  };

  const handleClose = () => {
    // Closing pauses drawing itself when persistence is required. Avoid a
    // separate collapse event, which could resume drawing under the toolbar
    // if persistence fails.
    setToolbarExpanded(false);
    send({ type: 'CLOSE_NOTE' });
  };

  const handleNewNote = () => {
    // Do not send TOOLBAR_COLLAPSED here: NEW_NOTE pauses drawing itself,
    // and a second resume event would race the reset actor.
    setToolbarExpanded(false);
    send({ type: 'NEW_NOTE' });
  };

  // ── Toolbar bounds → excludeRects ──────────────────────────
  // Tracks the toolbar's on-screen bounds so the Onyx SDK doesn't
  // capture stylus input over it. Updated via onLayout (no effects).

  const [toolbarRect, setToolbarRect] = useState<ExcludeRect | null>(null);

  const handleToolbarLayout = (event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    setToolbarRect({ x, y, width, height });
  };

  const excludeRects = toolbarRect ? [toolbarRect] : undefined;

  // ── Toolbar expand / collapse → XState ─────────────────────
  // Pauses raw drawing when expanded (so color/width pickers get
  // touch events), resumes when collapsed.

  const handleToggleToolbar = () => {
    setToolbarExpanded((prev) => {
      const next = !prev;
      send({ type: next ? 'TOOLBAR_EXPANDED' : 'TOOLBAR_COLLAPSED' });
      return next;
    });
  };

  const handleDismissToolbar = () => {
    setToolbarExpanded(false);
    send({ type: 'TOOLBAR_COLLAPSED' });
  };

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
      {isClosing ? (
        <View className="absolute inset-0 items-center justify-center bg-white/80">
          <ActivityIndicator size="large" color="#333" />
          <Text className="mt-3 text-base text-gray-600">Saving…</Text>
        </View>
      ) : (
        <>
          {toolbarExpanded ? (
            <Pressable className="absolute inset-0 z-10" onPress={handleDismissToolbar} />
          ) : null}
          <Toolbar
            expanded={toolbarExpanded}
            onClose={handleClose}
            onNewNote={handleNewNote}
            newNoteDisabled={
              !(snapshot.matches({ editing: 'clean' }) || snapshot.matches({ editing: 'dirty' }))
            }
            onToggleExpand={handleToggleToolbar}
            onLayout={handleToolbarLayout}
          />
        </>
      )}
    </View>
  );
}
