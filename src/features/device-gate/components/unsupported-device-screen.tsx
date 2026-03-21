import { Text, View } from 'react-native';

/**
 * Full-screen blocking view shown on non-Boox devices.
 * No navigation, no escape — the app requires Onyx Boox hardware.
 */
export function UnsupportedDeviceScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-white px-12">
      <Text className="mb-4 text-center text-3xl font-bold text-black">Brudnopis</Text>
      <Text className="text-center text-base leading-7 text-gray-600">
        This app requires an Onyx Boox e-ink tablet.{'\n'}It relies on the Boox pen SDK for
        low-latency drawing and is not designed to run on other devices.
      </Text>
    </View>
  );
}
