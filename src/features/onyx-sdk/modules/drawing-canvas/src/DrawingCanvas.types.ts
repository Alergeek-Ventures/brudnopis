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
  };
};

export type DrawingCanvasProps = {
  onStrokeEnd?: (event: StrokeEndEvent) => void;
} & ViewProps;

/** Serialized stroke data for the loadStrokes command. */
export type NativeStrokeData = {
  /** Packed point string: "x,y,p;x,y,p;..." */
  points: string;
  /** Hex color, e.g. "#000000" */
  color: string;
  /** Stroke width in pixels */
  width: number;
};

export type DrawingCanvasRef = {
  clear: () => Promise<void>;
  loadStrokes: (strokes: NativeStrokeData[]) => Promise<void>;
};
