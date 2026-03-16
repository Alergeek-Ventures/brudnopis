import { Link } from 'expo-router';
import { Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <View className="flex-1 gap-4 p-8">
      <Text className="text-3xl font-bold text-gray-900">Notes</Text>
      <Text className="text-base text-gray-900">Your notes will appear here.</Text>
      <Link href="/canvas" className="self-start rounded-lg bg-sky-700 px-6 py-3.5">
        <Text className="text-base font-semibold text-white">Open Canvas</Text>
      </Link>
    </View>
  );
}
