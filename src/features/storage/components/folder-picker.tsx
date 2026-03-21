import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { pickFolder } from '../utilities/storage';

export function FolderPicker() {
  const queryClient = useQueryClient();

  const pickMutation = useMutation({
    mutationFn: () => pickFolder(),
    onSuccess: (uri) => {
      if (uri) {
        queryClient.setQueryData(['folderUri'], uri);
        router.replace('/');
      }
    },
  });

  return (
    <View className="flex-1 items-center justify-center bg-white px-safe">
      <View className="items-center gap-6 px-8">
        <View className="gap-1">
          <Text className="text-center text-base leading-6 text-gray-600">
            Choose a folder to store your notes.
          </Text>
          <Text className="text-center text-base leading-6 text-gray-600">
            Documents are saved as SVG files.
          </Text>
        </View>
        {pickMutation.isError ? (
          <Text className="text-center text-sm text-red-700">
            Failed to pick folder. Please try again.
          </Text>
        ) : null}
        <Pressable
          onPress={() => pickMutation.mutate()}
          disabled={pickMutation.isPending}
          className="rounded-lg bg-sky-700 px-8 py-4 active:bg-sky-900 disabled:opacity-50"
        >
          <Text className="text-center text-base font-semibold text-white">
            {pickMutation.isPending ? 'Opening...' : 'Select Folder'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
