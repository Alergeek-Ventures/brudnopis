/** Metadata for a document in the file list. */
export type DocumentInfo = {
  /** SAF content URI for reading/writing this file. */
  uri: string;
  /** Original filename, e.g. "2026-03-16T14-30-00.svg". */
  filename: string;
  /** Parsed creation date, or null if filename doesn't match pattern. */
  createdAt: Date | null;
  /** Raw SVG content for thumbnail rendering. */
  svgContent?: string;
};
