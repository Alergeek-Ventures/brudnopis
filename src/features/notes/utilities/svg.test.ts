import { describe, expect, it } from 'vitest';
import type { Stroke } from '../types';
import { parseSvgDocument } from './svg-parser';
import { serializeSvgDocument } from './svg-serializer';

const sampleStrokes: Stroke[] = [
  {
    points: [
      { x: 100, y: 200, pressure: 0.45 },
      { x: 102, y: 203, pressure: 0.52 },
      { x: 105, y: 210, pressure: 0.61 },
    ],
    color: '#000000',
    width: 3,
  },
  {
    points: [
      { x: 500, y: 600, pressure: 0.8 },
      { x: 510, y: 610, pressure: 0.75 },
    ],
    color: '#FF0000',
    width: 5,
  },
];

describe('serializeSvgDocument', () => {
  it('produces valid SVG with viewBox', () => {
    const svg = serializeSvgDocument(sampleStrokes, 1872, 2404);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="1872"');
    expect(svg).toContain('height="2404"');
    expect(svg).toContain('viewBox="0 0 1872 2404"');
    expect(svg).toContain('</svg>');
  });

  it('generates path elements with d attribute', () => {
    const svg = serializeSvgDocument(sampleStrokes, 1872, 2404);
    expect(svg).toContain('d="M100,200L102,203L105,210"');
  });

  it('includes data-points attribute on each path', () => {
    const svg = serializeSvgDocument(sampleStrokes, 1872, 2404);
    expect(svg).toContain('data-points="100,200,0.45;102,203,0.52;105,210,0.61"');
    expect(svg).toContain('data-points="500,600,0.80;510,610,0.75"');
  });

  it('includes stroke color and width', () => {
    const svg = serializeSvgDocument(sampleStrokes, 1872, 2404);
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain('stroke="#FF0000"');
    expect(svg).toContain('stroke-width="3"');
    expect(svg).toContain('stroke-width="5"');
  });

  it('skips empty strokes', () => {
    const strokes: Stroke[] = [
      { points: [], color: '#000000', width: 3 },
      {
        points: [{ x: 10, y: 20, pressure: 0.5 }],
        color: '#000000',
        width: 3,
      },
    ];
    const svg = serializeSvgDocument(strokes, 100, 100);
    // Only one <path>, not two
    const pathCount = (svg.match(/<path /g) || []).length;
    expect(pathCount).toBe(1);
  });

  it('handles single-point stroke', () => {
    const strokes: Stroke[] = [
      {
        points: [{ x: 50, y: 60, pressure: 0.5 }],
        color: '#000000',
        width: 3,
      },
    ];
    const svg = serializeSvgDocument(strokes, 100, 100);
    expect(svg).toContain('d="M50,60l0,0"');
  });

  it('handles empty document', () => {
    const svg = serializeSvgDocument([], 1872, 2404);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    const pathCount = (svg.match(/<path /g) || []).length;
    expect(pathCount).toBe(0);
  });
});

describe('parseSvgDocument', () => {
  it('parses strokes from SVG with data-points', () => {
    const svg = serializeSvgDocument(sampleStrokes, 1872, 2404);
    const parsed = parseSvgDocument(svg);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].points).toEqual(sampleStrokes[0].points);
    expect(parsed[1].points).toEqual(sampleStrokes[1].points);
  });

  it('extracts color and width', () => {
    const svg = serializeSvgDocument(sampleStrokes, 1872, 2404);
    const parsed = parseSvgDocument(svg);
    expect(parsed[0].color).toBe('#000000');
    expect(parsed[0].width).toBe(3);
    expect(parsed[1].color).toBe('#FF0000');
    expect(parsed[1].width).toBe(5);
  });

  it('ignores paths without data-points', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path d="M0,0L100,100" stroke="#000" stroke-width="1" fill="none"/>
    </svg>`;
    const parsed = parseSvgDocument(svg);
    expect(parsed).toHaveLength(0);
  });

  it('returns empty array for non-SVG input', () => {
    expect(parseSvgDocument('hello world')).toEqual([]);
    expect(parseSvgDocument('')).toEqual([]);
  });

  it('defaults color to #000000 and width to 3 when missing', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path d="M0,0L10,10" data-points="0,0,0.50;10,10,0.50"/>
    </svg>`;
    const parsed = parseSvgDocument(svg);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].color).toBe('#000000');
    expect(parsed[0].width).toBe(3);
  });
});

describe('round-trip', () => {
  it('serialize → parse preserves all stroke data', () => {
    const svg = serializeSvgDocument(sampleStrokes, 1872, 2404);
    const parsed = parseSvgDocument(svg);
    expect(parsed).toEqual(sampleStrokes);
  });

  it('round-trips a document with many strokes', () => {
    const strokes: Stroke[] = Array.from({ length: 50 }, (_, i) => ({
      points: Array.from({ length: 20 }, (_, j) => ({
        x: i * 10 + j,
        y: i * 10 + j * 2,
        pressure: Math.round(Math.random() * 100) / 100,
      })),
      color: '#000000',
      width: 3,
    }));
    const svg = serializeSvgDocument(strokes, 1872, 2404);
    const parsed = parseSvgDocument(svg);
    expect(parsed).toEqual(strokes);
  });
});
