import { StyleSheet, Text, type TextProps } from 'react-native';

import { useThemeColor } from '@/lib/theme';

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  type?: 'default' | 'title' | 'defaultSemiBold' | 'subtitle' | 'link';
};

export function ThemedText({ style, lightColor, type = 'default', ...rest }: ThemedTextProps) {
  const color = useThemeColor({ light: lightColor }, 'text');
  const tint = useThemeColor({}, 'tint');

  return (
    <Text style={[{ color }, styles[type], type === 'link' && { color: tint }, style]} {...rest} />
  );
}

const styles = StyleSheet.create({
  default: {
    fontSize: 16,
    lineHeight: 24,
  },
  defaultSemiBold: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    lineHeight: 32,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  link: {
    lineHeight: 30,
    fontSize: 16,
  },
});
