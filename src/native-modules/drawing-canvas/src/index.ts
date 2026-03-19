import { requireNativeModule } from 'expo-modules-core';

export type {
  DrawingCanvasProps,
  DrawingCanvasRef,
  EraseEndEvent,
  ExcludeRect,
  NativeStrokeData,
  ReadyEvent,
  StrokeEndEvent,
} from './DrawingCanvas.types';
export { DrawingCanvasView } from './DrawingCanvasView';

const DrawingCanvasModule = requireNativeModule('DrawingCanvas');

/**
 * Trigger a full e-ink display refresh (GC waveform).
 * Drives every pixel black → white, eliminating all ghosting.
 * Decoupled from the canvas view — safe to call from anywhere.
 */
export async function refreshScreen(): Promise<void> {
  return DrawingCanvasModule.refreshScreen();
}
