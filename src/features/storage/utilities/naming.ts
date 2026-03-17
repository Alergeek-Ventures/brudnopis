import { format, parse } from 'date-fns';

/** Filesystem-safe ISO-ish pattern: "2026-03-16T14-30-00" */
const FILENAME_FORMAT = "yyyy-MM-dd'T'HH-mm-ss";
const FILENAME_EXTENSION = '.svg';

/**
 * Generate a timestamp-based filename for a new document.
 * Format: "2026-03-16T14-30-00.svg" — filesystem-safe ISO-ish format.
 * Lexicographic sort = chronological order.
 */
export function generateFilename(date: Date = new Date()): string {
  return `${format(date, FILENAME_FORMAT)}${FILENAME_EXTENSION}`;
}

/**
 * Parse a document filename back to a Date.
 * Returns null if the filename doesn't match the expected pattern.
 */
export function parseFilenameToDate(filename: string): Date | null {
  if (!filename.endsWith(FILENAME_EXTENSION)) return null;

  const stem = filename.slice(0, -FILENAME_EXTENSION.length);
  const parsed = parse(stem, FILENAME_FORMAT, new Date(0));
  // parse() returns Invalid Date on failure
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Format a Date as a human-readable display name.
 * E.g., "Mar 16, 2026, 14:30"
 * Omits seconds for cleanliness (seconds are in filename for uniqueness only).
 */
export function formatDisplayName(date: Date): string {
  return format(date, 'MMM d, yyyy, HH:mm');
}
