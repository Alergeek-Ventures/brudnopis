import { useMutation } from '@tanstack/react-query';
import { Pressable, Text, View } from 'react-native';
import { pickFolder } from '@/features/storage/utilities/storage';

export function Settings() {
  const changeFolderMutation = useMutation({
    mutationFn: () => pickFolder(),
  });

  return (
    <View className="flex-1 pt-safe px-safe">
      <View className="border-b border-gray-300 px-6 pb-4 pt-2">
        <Text className="text-2xl font-bold text-black">Settings</Text>
      </View>

      <View className="mt-8">
        <Text className="px-6 pb-2 text-sm font-semibold uppercase tracking-wide text-gray-600">
          Storage
        </Text>
        <View className="border-b border-gray-300 px-6 py-4">
          <Pressable
            onPress={() => changeFolderMutation.mutate()}
            disabled={changeFolderMutation.isPending}
            className="rounded-lg bg-gray-200 px-4 py-2.5 active:bg-gray-300 disabled:opacity-50"
          >
            <Text className="text-center text-sm text-black">
              {changeFolderMutation.isPending ? 'Changing...' : 'Change Folder'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
