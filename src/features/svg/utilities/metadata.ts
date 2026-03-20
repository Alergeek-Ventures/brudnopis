/**
 * Extract recognized text from SVG <metadata> element.
 * Returns undefined if no metadata found.
 */
export function extractMetadataText(svg: string): string | undefined {
  const match = /<metadata>([\s\S]*?)<\/metadata>/.exec(svg);
  if (!match) return undefined;

  return (
    match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim() || undefined
  );
}

/**
 * Write recognized text into SVG as a <metadata> element.
 * Inserts after the opening <svg> tag. Replaces existing <metadata> if present.
 */
export function insertMetadata(svg: string, text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const metadataBlock = `<metadata>${escaped}</metadata>`;
  const withoutExisting = svg.replace(/<metadata>[\s\S]*?<\/metadata>\n?/, '');
  return withoutExisting.replace(/(<svg[^>]*>)\n?/, `$1\n${metadataBlock}\n`);
}
