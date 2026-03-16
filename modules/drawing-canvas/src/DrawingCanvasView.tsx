import { requireNativeViewManager } from 'expo-modules-core';

import type { DrawingCanvasProps } from './DrawingCanvas.types';

const NativeView: React.ComponentType<DrawingCanvasProps> =
  requireNativeViewManager('DrawingCanvas');

export function DrawingCanvasView(props: DrawingCanvasProps) {
  return <NativeView {...props} />;
}
