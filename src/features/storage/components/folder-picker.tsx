import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { pickFolder } from '../utilities/storage';

export function FolderPicker() {
  const pickMutation = useMutation({
    mutationFn: () => pickFolder(),
    onSuccess: (uri) => {
      if (uri) {
        router.replace('/');
      }
    },
  });

  return (
    <View className="bg-white pt-safe px-safe">
      <View className="px-8">
        <Text className="text-center text-base leading-6 text-gray-600">
          Choose a folder to store your notes.
        </Text>
        <Text className="text-center text-base leading-6 text-gray-600">
          Documents are saved as SVG files.
        </Text>
        {pickMutation.isError && (
          <Text className="text-center text-sm text-red-600">
            Failed to pick folder. Please try again.
          </Text>
        )}
        <Pressable
          onPress={() => pickMutation.mutate()}
          disabled={pickMutation.isPending}
          className="rounded-lg bg-sky-700 px-8 py-4 active:bg-sky-800 disabled:opacity-50"
        >
          <Text className="text-center text-base font-semibold text-white">
            {pickMutation.isPending ? 'Opening...' : 'Select Folder'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
