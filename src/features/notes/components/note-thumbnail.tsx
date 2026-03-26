import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Path, Svg } from 'react-native-svg';

import { parseSvgDocument } from '@/features/svg/utilities/svg-parser';
import { pointsToPathD } from '@/features/svg/utilities/svg-serializer';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/types/canvas';

export function NoteThumbnail({ svgContent }: { svgContent: string }) {
  const strokes = useMemo(() => parseSvgDocument(svgContent).strokes, [svgContent]);

  if (strokes.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-100">
        <Text className="text-sm text-gray-600">Empty</Text>
      </View>
    );
  }

  return (
    <Svg viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} width="100%" height="100%">
      {strokes.map((stroke, i) => (
        <Path
          // biome-ignore lint/suspicious/noArrayIndexKey: static array from parsed SVG, never reordered
          key={i}
          d={pointsToPathD(stroke)}
          stroke={stroke.color}
          strokeWidth={stroke.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity={stroke.style === 'marker' ? 0.3 : 1}
        />
      ))}
    </Svg>
  );
}
