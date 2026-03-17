import type { Stroke } from '../types';
import { encodePoints } from './points';

/**
 * Generate an SVG path `d` attribute from raw points.
 * Uses polyline (M/L) for now — can be upgraded to cubic bezier later.
 * Since data-points is the source of truth, this is a rendering-only concern.
 */
function pointsToPathD(stroke: Stroke): string {
  const { points } = stroke;
  if (points.length === 0) return '';
  if (points.length === 1) {
    // Single point — draw a tiny line so it's visible
    const p = points[0];
    return `M${Math.round(p.x)},${Math.round(p.y)}l0,0`;
  }

  return points
    .map((p, i) => {
      const cmd = i === 0 ? 'M' : 'L';
      return `${cmd}${Math.round(p.x)},${Math.round(p.y)}`;
    })
    .join('');
}

/**
 * Serialize a document (array of strokes + canvas dimensions) to an SVG string.
 *
 * Each stroke becomes a <path> element with:
 * - `d` attribute: rendered polyline (display layer, regenerated from data)
 * - `data-points` attribute: packed point string (edit layer, source of truth)
 * - `stroke`, `stroke-width`: visual properties
 *
 * The data-points attribute is the source of truth. The visible paths are a
 * cached render. If rendering is upgraded later (e.g., bezier curves, variable
 * width), paths are regenerated from the same stroke data.
 */
export function serializeSvgDocument(strokes: Stroke[], width: number, height: number): string {
  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  ];

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;

    const d = pointsToPathD(stroke);
    const dataPoints = encodePoints(stroke.points);

    lines.push(
      `  <path d="${d}" stroke="${stroke.color}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round" fill="none" data-points="${dataPoints}"/>`,
    );
  }

  lines.push('</svg>');
  return lines.join('\n');
}
