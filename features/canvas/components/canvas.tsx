import { DrawingCanvasView } from 'drawing-canvas';
import { View } from 'react-native';

export function Canvas() {
  return (
    <View className="flex-1 bg-white">
      <DrawingCanvasView className="flex-1" onStrokeEnd={() => {}} />
    </View>
  );
}
