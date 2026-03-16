import { View, type ViewProps } from 'react-native';

import { useThemeColor } from '@/lib/theme';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
};

export function ThemedView({ style, lightColor, ...otherProps }: ThemedViewProps) {
  const backgroundColor = useThemeColor({ light: lightColor }, 'background');

  return <View style={[{ backgroundColor }, style]} {...otherProps} />;
}
