import { describe, expect, it } from 'vitest';
import { decodePoints, encodePoints } from './points';

describe('encodePoints', () => {
  it('encodes a single point', () => {
    const result = encodePoints([{ x: 100, y: 200, pressure: 0.45 }]);
    expect(result).toBe('100,200,0.45');
  });

  it('encodes multiple points separated by semicolons', () => {
    const result = encodePoints([
      { x: 100, y: 200, pressure: 0.45 },
      { x: 102, y: 203, pressure: 0.52 },
      { x: 105, y: 210, pressure: 0.61 },
    ]);
    expect(result).toBe('100,200,0.45;102,203,0.52;105,210,0.61');
  });

  it('rounds coordinates to integers', () => {
    const result = encodePoints([{ x: 100.7, y: 200.3, pressure: 0.456 }]);
    expect(result).toBe('101,200,0.46');
  });

  it('returns empty string for empty array', () => {
    expect(encodePoints([])).toBe('');
  });

  it('handles zero pressure', () => {
    const result = encodePoints([{ x: 0, y: 0, pressure: 0 }]);
    expect(result).toBe('0,0,0.00');
  });

  it('handles full pressure', () => {
    const result = encodePoints([{ x: 1872, y: 2404, pressure: 1 }]);
    expect(result).toBe('1872,2404,1.00');
  });
});

describe('decodePoints', () => {
  it('decodes a single point', () => {
    const result = decodePoints('100,200,0.45');
    expect(result).toEqual([{ x: 100, y: 200, pressure: 0.45 }]);
  });

  it('decodes multiple points', () => {
    const result = decodePoints('100,200,0.45;102,203,0.52;105,210,0.61');
    expect(result).toEqual([
      { x: 100, y: 200, pressure: 0.45 },
      { x: 102, y: 203, pressure: 0.52 },
      { x: 105, y: 210, pressure: 0.61 },
    ]);
  });

  it('returns empty array for empty string', () => {
    expect(decodePoints('')).toEqual([]);
  });

  it('returns empty array for malformed input (missing values)', () => {
    expect(decodePoints('100,200')).toEqual([]);
  });

  it('returns empty array for malformed input (partial segment)', () => {
    expect(decodePoints('100,200,0.5;bad')).toEqual([]);
  });
});

describe('round-trip', () => {
  it('encode → decode preserves data (within rounding)', () => {
    const original = [
      { x: 100, y: 200, pressure: 0.45 },
      { x: 102, y: 203, pressure: 0.52 },
      { x: 105, y: 210, pressure: 0.61 },
    ];
    const encoded = encodePoints(original);
    const decoded = decodePoints(encoded);
    expect(decoded).toEqual(original);
  });

  it('round-trips large coordinate values', () => {
    const original = [{ x: 1872, y: 2404, pressure: 0.99 }];
    const encoded = encodePoints(original);
    const decoded = decodePoints(encoded);
    expect(decoded).toEqual(original);
  });
});
