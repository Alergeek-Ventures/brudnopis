import type { ViewProps } from 'react-native';

export type StrokeEndEvent = {
  nativeEvent: {
    pathCount: number;
    /** Packed point string: "x,y,p;x,y,p;..." */
    points: string;
    /** Hex color, e.g. "#000000" */
    color: string;
    /** Stroke width in pixels */
    width: number;
    /** Pen style — "pencil", "fountain", or "marker". */
    style: string;
  };
};

export type EraseEndEvent = {
  nativeEvent: {
    /** Indices of erased strokes, sorted descending for safe splice. */
    indices: number[];
  };
};

export type ReadyEvent = {
  nativeEvent: Record<string, never>;
};

/** Rectangle describing an exclusion zone (in view coordinates). */
export type ExcludeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DrawingCanvasProps = {
  /** Background pattern for the canvas. Defaults to "blank" (plain white). */
  backgroundPattern?: 'blank' | 'dotted';
  /** Pen type — maps to Onyx SDK stroke styles. Defaults to "pencil". */
  penType?: 'pencil' | 'fountain' | 'marker';
  /** Stroke color as hex string, e.g. "#000000". Defaults to black. */
  strokeColor?: string;
  /** Stroke width in pixels. Defaults to 5. */
  strokeWidth?: number;
  /**
   * Areas where the SDK should NOT capture stylus input.
   * Used to carve out toolbar / UI overlay regions from the drawing surface.
   * Updates take effect on the next pen-down event without a raw drawing toggle.
   */
  excludeRects?: ExcludeRect[];
  /** Fired when the native SurfaceView is created and ready for commands. */
  onReady?: (event: ReadyEvent) => void;
  onStrokeEnd?: (event: StrokeEndEvent) => void;
  onEraseEnd?: (event: EraseEndEvent) => void;
} & ViewProps;

/** Serialized stroke data for the loadStrokes command. */
export type NativeStrokeData = {
  /** Packed point string: "x,y,p;x,y,p;..." */
  points: string;
  /** Hex color, e.g. "#000000" */
  color: string;
  /** Stroke width in pixels */
  width: number;
  /** Pen style — "pencil", "fountain", or "marker". Defaults to "pencil" on native side. */
  style?: string;
};

export type DrawingCanvasRef = {
  /**
   * Open raw drawing mode — freezes e-ink screen and starts capturing
   * stylus input. Must be called AFTER loadStrokes has completed so the
   * bitmap is visible before the screen freezes.
   */
  startDrawing: () => Promise<void>;
  /**
   * Close raw drawing mode permanently — disables SDK input capture and
   * releases resources. The SurfaceView stays alive so the bitmap remains
   * visible until the view unmounts. Idempotent.
   */
  stopDrawing: () => Promise<void>;
  /**
   * Temporarily disable raw drawing — unfreezes the e-ink screen so overlay
   * views (toolbar) receive touch events. Blits the bitmap to the surface
   * first so current content stays visible. Call resumeDrawing() to re-enable.
   */
  pauseDrawing: () => Promise<void>;
  /**
   * Re-enable raw drawing after a pause. Freezes the e-ink screen again
   * and resumes stylus input capture.
   */
  resumeDrawing: () => Promise<void>;
  clear: () => Promise<void>;
  loadStrokes: (strokes: NativeStrokeData[]) => Promise<void>;
};
