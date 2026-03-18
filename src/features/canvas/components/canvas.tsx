import { useFocusEffect } from '@react-navigation/native';
import type { DrawingCanvasRef, EraseEndEvent, StrokeEndEvent } from 'drawing-canvas';
import { DrawingCanvasView as NativeDrawingCanvasView } from 'drawing-canvas';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useRef } from 'react';
import { BackHandler, Pressable, Text, View } from 'react-native';
import { withUniwind } from 'uniwind';

import { noteLifecycleMachineAtom } from '@/features/recognition/atoms';
import { activeLanguageAtom } from '@/features/settings/atoms';
import type { Stroke } from '@/features/svg/types';

const DrawingCanvasView = withUniwind(NativeDrawingCanvasView);

// Default canvas dimensions — matches typical Boox screen.
const CANVAS_WIDTH = 1872;
const CANVAS_HEIGHT = 2404;
const BACKGROUND_PATTERN = 'dotted' as const;

export function Canvas() {
  const { fileUri } = useLocalSearchParams<{ fileUri: string }>();

  if (!fileUri) {
    return <Redirect href="/" />;
  }

  return <CanvasContent fileUri={fileUri} />;
}

function CanvasContent({ fileUri }: { fileUri: string }) {
  const canvasRef = useRef<DrawingCanvasRef>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeLanguage = useAtomValue(activeLanguageAtom);
  const [, send] = useAtom(noteLifecycleMachineAtom);

  // On focus: block hardware back, tell the machine to open this note.
  // On blur (cleanup): remove back handler.
  // OPEN_NOTE is idempotent — if already editing this fileUri, the machine
  // re-enters (which is correct: stops old child, starts fresh).
  useFocusEffect(
    useCallback(() => {
      send({
        type: 'OPEN_NOTE',
        fileUri,
        lang: activeLanguage,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        backgroundPattern: BACKGROUND_PATTERN,
        strokesRef,
        canvasRef,
      });

      const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
      return () => sub.remove();
    }, [fileUri, activeLanguage, send]),
  );

  const handleStrokeEnd = (event: StrokeEndEvent) => {
    send({
      type: 'STROKE_END',
      points: event.nativeEvent.points,
      color: event.nativeEvent.color,
      width: event.nativeEvent.width,
    });
  };

  const handleEraseEnd = (event: EraseEndEvent) => {
    send({
      type: 'ERASE_END',
      indices: event.nativeEvent.indices,
    });
  };

  const handleClose = () => {
    send({ type: 'CLOSE_NOTE' });
  };

  return (
    <View className="flex-1 bg-white">
      <View className="absolute right-4 top-4 z-10">
        <Pressable
          onPress={handleClose}
          className="rounded-lg bg-gray-800/80 px-4 py-2.5 active:bg-gray-900"
        >
          <Text className="text-sm font-semibold text-white">Close</Text>
        </Pressable>
      </View>
      <DrawingCanvasView
        ref={canvasRef}
        className="flex-1"
        backgroundPattern={BACKGROUND_PATTERN}
        onStrokeEnd={handleStrokeEnd}
        onEraseEnd={handleEraseEnd}
      />
    </View>
  );
}
