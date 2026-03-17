import type { Stroke } from '../types';
import { decodePoints } from './points';

/**
 * Parse an SVG document string back into an array of Strokes.
 *
 * Constraint: this parser only handles SVG produced by our own svg-serializer.
 * It uses regex to extract self-closing <path .../> elements. This will break
 * on arbitrary SVG (multi-line elements, non-self-closing paths, etc.).
 *
 * Extracts data-points attributes from <path> elements — these are the source
 * of truth. The `d` attribute (rendered path) is ignored; strokes are
 * reconstructed entirely from data-points.
 *
 * Also extracts stroke color and width from the path attributes.
 * Falls back to defaults (#000000, 3) if not present.
 *
 * Returns empty array for invalid/empty SVG.
 */
export function parseSvgDocument(svg: string): Stroke[] {
  const strokes: Stroke[] = [];

  // Match all <path ... /> elements (self-closing)
  const pathRegex = /<path\s([^>]*?)\/>/g;

  for (let pathMatch = pathRegex.exec(svg); pathMatch !== null; pathMatch = pathRegex.exec(svg)) {
    const attrs = pathMatch[1];

    // Extract data-points attribute — this is the source of truth
    const dataPointsMatch = /data-points="([^"]*)"/.exec(attrs);
    if (!dataPointsMatch) continue; // skip paths without data-points

    const points = decodePoints(dataPointsMatch[1]);
    if (points.length === 0) continue;

    // Extract stroke color (default: #000000)
    const colorMatch = /\sstroke="([^"]*)"/.exec(attrs);
    const color = colorMatch ? colorMatch[1] : '#000000';

    // Extract stroke width (default: 3)
    const widthMatch = /stroke-width="([^"]*)"/.exec(attrs);
    const width = widthMatch ? Number(widthMatch[1]) : 3;

    strokes.push({ points, color, width });
  }

  return strokes;
}
