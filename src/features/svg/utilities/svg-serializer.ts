import type { BackgroundPattern, Stroke } from '../types';
import { encodePoints } from './points';

/** Dot spacing in pixels — must match the native canvas (DrawingCanvasView.kt). */
const DOT_SPACING = 80;
/** Dot radius in pixels — must match the native canvas. */
const DOT_RADIUS = 3;
/** Dot color — must match the native canvas (Color.LTGRAY = #C0C0C0). */
const DOT_COLOR = '#C0C0C0';

/**
 * Generate an SVG path `d` attribute from raw points.
 * Uses polyline (M/L) for now — can be upgraded to cubic bezier later.
 * Since data-points is the source of truth, this is a rendering-only concern.
 */
export function pointsToPathD(stroke: Stroke): string {
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
 *
 * When backgroundPattern is "dotted", emits a <defs>/<pattern>/<rect> block
 * that renders a dot grid in any SVG viewer (browser, Obsidian, etc.).
 * The pattern metadata is stored on the root <svg> as `data-background="dotted"`
 * so the parser can round-trip it.
 */
export function serializeSvgDocument(
  strokes: Stroke[],
  width: number,
  height: number,
  backgroundPattern: BackgroundPattern = 'blank',
): string {
  const bgAttr = backgroundPattern !== 'blank' ? ` data-background="${backgroundPattern}"` : '';

  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"${bgAttr}>`,
  ];

  if (backgroundPattern === 'dotted') {
    lines.push('  <defs>');
    lines.push(
      `    <pattern id="dotted-bg" x="${DOT_SPACING}" y="${DOT_SPACING}" width="${DOT_SPACING}" height="${DOT_SPACING}" patternUnits="userSpaceOnUse">`,
    );
    lines.push(`      <circle cx="0" cy="0" r="${DOT_RADIUS}" fill="${DOT_COLOR}"/>`);
    lines.push('    </pattern>');
    lines.push('  </defs>');
    lines.push('  <rect width="100%" height="100%" fill="white"/>');
    lines.push('  <rect width="100%" height="100%" fill="url(#dotted-bg)"/>');
  }

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
