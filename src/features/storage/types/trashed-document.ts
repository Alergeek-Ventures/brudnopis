/** A document that has been moved to the trash. */
export type TrashedDocument = {
  /** SAF content URI. */
  uri: string;
  /** Original filename for display. */
  filename: string;
  /** Unix timestamp (ms) when the document was trashed. */
  deletedAt: number;
  /** Raw SVG content for thumbnail rendering (loaded on demand, not persisted in metadata). */
  svgContent?: string;
};
