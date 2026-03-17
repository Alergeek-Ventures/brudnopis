import { describe, expect, it } from 'vitest';
import { formatDisplayName, generateFilename, parseFilenameToDate } from './naming';

describe('generateFilename', () => {
  it('generates ISO-ish timestamp filename', () => {
    const date = new Date(2026, 2, 16, 14, 30, 0); // March 16, 2026 14:30:00
    expect(generateFilename(date)).toBe('2026-03-16T14-30-00.svg');
  });

  it('pads single-digit values', () => {
    const date = new Date(2026, 0, 5, 9, 3, 7); // Jan 5, 2026 09:03:07
    expect(generateFilename(date)).toBe('2026-01-05T09-03-07.svg');
  });

  it('uses current time when no argument given', () => {
    const filename = generateFilename();
    expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.svg$/);
  });
});

describe('parseFilenameToDate', () => {
  it('parses a valid filename', () => {
    const date = parseFilenameToDate('2026-03-16T14-30-00.svg');
    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(2); // March = 2
    expect(date?.getDate()).toBe(16);
    expect(date?.getHours()).toBe(14);
    expect(date?.getMinutes()).toBe(30);
    expect(date?.getSeconds()).toBe(0);
  });

  it('returns null for non-matching filename', () => {
    expect(parseFilenameToDate('random-file.svg')).toBeNull();
    expect(parseFilenameToDate('notes.txt')).toBeNull();
    expect(parseFilenameToDate('')).toBeNull();
  });

  it('returns null for partial match', () => {
    expect(parseFilenameToDate('2026-03-16T14-30.svg')).toBeNull();
  });
});

describe('round-trip', () => {
  it('generate → parse round-trips the date', () => {
    const original = new Date(2026, 2, 16, 14, 30, 45);
    const filename = generateFilename(original);
    const parsed = parseFilenameToDate(filename);
    expect(parsed).not.toBeNull();
    expect(parsed?.getTime()).toBe(original.getTime());
  });
});

describe('formatDisplayName', () => {
  it('formats a date for display', () => {
    const date = new Date(2026, 2, 16, 14, 30, 0);
    expect(formatDisplayName(date)).toBe('Mar 16, 2026, 14:30');
  });
});
