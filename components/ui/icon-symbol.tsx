// Fallback for using MaterialIcons on Android (iOS uses native SF Symbols via icon-symbol.ios.tsx).

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { SymbolViewProps, SymbolWeight } from 'expo-symbols';
import type { ComponentProps } from 'react';
import type { OpaqueColorValue, StyleProp, TextStyle } from 'react-native';

type IconMapping = Record<
  Extract<SymbolViewProps['name'], string>,
  ComponentProps<typeof MaterialIcons>['name']
>;
type IconSymbolName = keyof typeof MAPPING;

/**
 * Maps SF Symbol names to Material Icons.
 * See https://icons.expo.fyi for the full directory.
 */
const MAPPING = {
  'house.fill': 'home',
  'paperplane.fill': 'send',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron-right',
} as IconMapping;

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
