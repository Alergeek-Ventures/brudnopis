import type { BackgroundPattern, Stroke, StrokeStyle } from '../types';

import { decodePoints } from './points';

export type ParsedDocument = {
  strokes: Stroke[];
  /** Background pattern parsed from `data-background` on the root <svg> element. */
  backgroundPattern: BackgroundPattern;
};

/**
 * Parse an SVG document string back into strokes and metadata.
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
 * Extracts `data-background` from the root <svg> element for background
 * pattern metadata (e.g., "dotted"). Defaults to "blank".
 *
 * Returns empty strokes array and "blank" background for invalid/empty SVG.
 */
export function parseSvgDocument(svg: string): ParsedDocument {
  const strokes: Stroke[] = [];

  // Extract background pattern from root <svg> element
  const bgMatch = /data-background="([^"]*)"/.exec(svg);
  const backgroundPattern: BackgroundPattern =
    bgMatch && bgMatch[1] === 'dotted' ? bgMatch[1] : 'blank';

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

    // Extract stroke style — only set when explicitly present (default is pencil/undefined).
    const styleMatch = /data-style="([^"]*)"/.exec(attrs);
    const style: StrokeStyle | undefined =
      styleMatch && (styleMatch[1] === 'fountain' || styleMatch[1] === 'marker')
        ? styleMatch[1]
        : undefined;

    strokes.push({ points, color, width, ...(style && { style }) });
  }

  return { strokes, backgroundPattern };
}
