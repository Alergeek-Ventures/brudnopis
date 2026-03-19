/** A single captured point from the stylus. */
export type Point = {
  x: number;
  y: number;
  /** Pressure value from the digitizer, 0.0–1.0. */
  pressure: number;
  /** Timestamp in milliseconds from the Onyx SDK TouchPoint. */
  t: number;
};

/** Pen style — maps to Onyx SDK stroke styles on the native side. */
export type StrokeStyle = 'pencil' | 'fountain' | 'marker';

/** A single stroke: a sequence of points with visual properties. */
export type Stroke = {
  points: Point[];
  /** Hex color, e.g. "#000000". */
  color: string;
  /** Stroke width in pixels. */
  width: number;
  /** Pen style. Defaults to "pencil" for backward compatibility. */
  style?: StrokeStyle;
};

/** Canvas background pattern. Stored in SVG as `data-background` on the root element. */
export type BackgroundPattern = 'blank' | 'dotted';
