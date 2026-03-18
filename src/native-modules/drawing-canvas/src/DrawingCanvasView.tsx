import { requireNativeViewManager } from 'expo-modules-core';
import { forwardRef } from 'react';

import type { DrawingCanvasProps, DrawingCanvasRef } from './DrawingCanvas.types';

const NativeView: React.ComponentType<DrawingCanvasProps & { ref?: React.Ref<DrawingCanvasRef> }> =
  requireNativeViewManager('DrawingCanvas');

/**
 * Drawing canvas backed by a native SurfaceView.
 *
 * Accepts a ref with:
 * - `clear()` — clears all strokes
 * - `loadStrokes(strokes)` — loads serialized stroke data and renders to bitmap
 */
export const DrawingCanvasView = forwardRef<DrawingCanvasRef, DrawingCanvasProps>(
  function DrawingCanvasView(props, ref) {
    return <NativeView ref={ref} {...props} />;
  },
);
