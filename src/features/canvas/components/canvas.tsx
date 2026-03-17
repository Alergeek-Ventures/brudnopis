import type { DrawingCanvasRef } from 'drawing-canvas';
import { DrawingCanvasView as NativeDrawingCanvasView } from 'drawing-canvas';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { View } from 'react-native';
import { withUniwind } from 'uniwind';
import { useDocument } from '@/features/notes/utilities/use-document';

const DrawingCanvasView = withUniwind(NativeDrawingCanvasView);

// Default canvas dimensions — matches typical Boox screen.
// Will be replaced by actual layout dimensions when we add onLayout handling.
const CANVAS_WIDTH = 1872;
const CANVAS_HEIGHT = 2404;

export function Canvas() {
  const { fileUri } = useLocalSearchParams<{ fileUri: string }>();

  if (!fileUri) {
    return <Redirect href="/" />;
  }

  return <CanvasContent fileUri={fileUri} />;
}

function CanvasContent({ fileUri }: { fileUri: string }) {
  const canvasRef = useRef<DrawingCanvasRef>(null);

  const { handleStrokeEnd } = useDocument({
    fileUri,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    canvasRef,
  });

  return (
    <View className="flex-1 bg-white">
      <DrawingCanvasView ref={canvasRef} className="flex-1" onStrokeEnd={handleStrokeEnd} />
    </View>
  );
}
