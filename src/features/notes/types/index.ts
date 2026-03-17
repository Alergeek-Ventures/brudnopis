/** A single captured point from the stylus. */
export type Point = {
  x: number;
  y: number;
  /** Pressure value from the digitizer, 0.0–1.0. */
  pressure: number;
};

/** A single stroke: a sequence of points with visual properties. */
export type Stroke = {
  points: Point[];
  /** Hex color, e.g. "#000000". */
  color: string;
  /** Stroke width in pixels. */
  width: number;
};
