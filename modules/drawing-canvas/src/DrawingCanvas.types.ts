import type { ViewProps } from 'react-native';

export type StrokeEndEvent = {
  nativeEvent: {
    pathCount: number;
  };
};

export type DrawingCanvasProps = {
  onStrokeEnd?: (event: StrokeEndEvent) => void;
} & ViewProps;

export type DrawingCanvasRef = {
  clear: () => Promise<void>;
};
