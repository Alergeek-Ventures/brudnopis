import type { Point } from '../types';

/**
 * Encode an array of points to a packed string.
 * Format: "x,y,p,t;x,y,p,t;..." — integers for x/y/t, 2 decimal places for pressure.
 *
 * This is the canonical serialization format used both for bridge communication
 * (native -> JS) and for the data-points SVG attribute. Same format everywhere
 * means no conversion step.
 *
 * The same format is implemented in Kotlin for the native side:
 * @see src/native-modules/drawing-canvas/android/src/main/java/expo/modules/drawingcanvas/DrawingCanvasView.kt — serializePoints/deserializePoints
 */
export function encodePoints(points: Point[]): string {
  return points
    .map((p) => `${Math.round(p.x)},${Math.round(p.y)},${p.pressure.toFixed(2)},${Math.round(p.t)}`)
    .join(';');
}

/**
 * Decode a packed point string back to an array of Points.
 * Inverse of encodePoints. Returns empty array for empty/invalid input.
 */
export function decodePoints(raw: string): Point[] {
  if (!raw) return [];

  const segments = raw.split(';');
  const points: Point[] = [];

  for (const segment of segments) {
    const parts = segment.split(',');
    if (parts.length < 4) return []; // malformed — bail entirely
    points.push({
      x: Number(parts[0]),
      y: Number(parts[1]),
      pressure: Number(parts[2]),
      t: Number(parts[3]),
    });
  }

  return points;
}
