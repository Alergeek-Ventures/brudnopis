import { describe, expect, it } from 'vitest';
import { decodePoints, encodePoints } from './points';

describe('encodePoints', () => {
  it('encodes a single point', () => {
    const result = encodePoints([{ x: 100, y: 200, pressure: 0.45, t: 1000 }]);
    expect(result).toBe('100,200,0.45,1000');
  });

  it('encodes multiple points separated by semicolons', () => {
    const result = encodePoints([
      { x: 100, y: 200, pressure: 0.45, t: 1000 },
      { x: 102, y: 203, pressure: 0.52, t: 1010 },
      { x: 105, y: 210, pressure: 0.61, t: 1020 },
    ]);
    expect(result).toBe('100,200,0.45,1000;102,203,0.52,1010;105,210,0.61,1020');
  });

  it('rounds coordinates and timestamps to integers', () => {
    const result = encodePoints([{ x: 100.7, y: 200.3, pressure: 0.456, t: 1000.8 }]);
    expect(result).toBe('101,200,0.46,1001');
  });

  it('returns empty string for empty array', () => {
    expect(encodePoints([])).toBe('');
  });

  it('handles zero pressure', () => {
    const result = encodePoints([{ x: 0, y: 0, pressure: 0, t: 0 }]);
    expect(result).toBe('0,0,0.00,0');
  });

  it('handles full pressure', () => {
    const result = encodePoints([{ x: 1872, y: 2404, pressure: 1, t: 99999 }]);
    expect(result).toBe('1872,2404,1.00,99999');
  });
});

describe('decodePoints', () => {
  it('decodes a single point', () => {
    const result = decodePoints('100,200,0.45,1000');
    expect(result).toEqual([{ x: 100, y: 200, pressure: 0.45, t: 1000 }]);
  });

  it('decodes multiple points', () => {
    const result = decodePoints('100,200,0.45,1000;102,203,0.52,1010;105,210,0.61,1020');
    expect(result).toEqual([
      { x: 100, y: 200, pressure: 0.45, t: 1000 },
      { x: 102, y: 203, pressure: 0.52, t: 1010 },
      { x: 105, y: 210, pressure: 0.61, t: 1020 },
    ]);
  });

  it('returns empty array for empty string', () => {
    expect(decodePoints('')).toEqual([]);
  });

  it('returns empty array for malformed input (missing values)', () => {
    expect(decodePoints('100,200,0.5')).toEqual([]);
  });

  it('returns empty array for malformed input (partial segment)', () => {
    expect(decodePoints('100,200,0.5,1000;bad')).toEqual([]);
  });
});

describe('round-trip', () => {
  it('encode -> decode preserves data (within rounding)', () => {
    const original = [
      { x: 100, y: 200, pressure: 0.45, t: 1000 },
      { x: 102, y: 203, pressure: 0.52, t: 1010 },
      { x: 105, y: 210, pressure: 0.61, t: 1020 },
    ];
    const encoded = encodePoints(original);
    const decoded = decodePoints(encoded);
    expect(decoded).toEqual(original);
  });

  it('round-trips large coordinate values', () => {
    const original = [{ x: 1872, y: 2404, pressure: 0.99, t: 1742300000000 }];
    const encoded = encodePoints(original);
    const decoded = decodePoints(encoded);
    expect(decoded).toEqual(original);
  });
});
