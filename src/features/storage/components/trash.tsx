import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import type { TrashedDocument } from '../atoms';
import { permanentlyDeleteDocument, restoreDocument } from '../utilities/trash';

const TRASH_KEY = 'trashed_documents';

/** 7 days in milliseconds. */
const TRASH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function readTrashedDocs(): Promise<TrashedDocument[]> {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  const raw = await AsyncStorage.getItem(TRASH_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as TrashedDocument[];
  } catch {
    return [];
  }
}

function formatDaysRemaining(deletedAt: number): string {
  const elapsed = Date.now() - deletedAt;
  const remaining = Math.max(0, Math.ceil((TRASH_TTL_MS - elapsed) / (24 * 60 * 60 * 1000)));
  if (remaining === 0) return 'Expiring soon';
  if (remaining === 1) return '1 day remaining';
  return `${remaining} days remaining`;
}

function formatDeletedDate(deletedAt: number): string {
  const date = new Date(deletedAt);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function TrashedItem({
  item,
  onRestore,
  onDelete,
}: {
  item: TrashedDocument;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const handleDelete = () => {
    Alert.alert('Delete Permanently?', 'This note will be permanently deleted.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  };

  return (
    <View className="flex-row items-center justify-between border-b border-gray-300 px-6 py-4">
      <View className="flex-1 pr-4">
        <Text className="text-base text-black" numberOfLines={1}>
          {item.filename}
        </Text>
        <Text className="mt-0.5 text-sm text-gray-600">
          Deleted {formatDeletedDate(item.deletedAt)} · {formatDaysRemaining(item.deletedAt)}
        </Text>
      </View>
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={onRestore}
          className="rounded-lg border border-gray-400 bg-gray-200 px-4 py-2.5 active:bg-gray-300"
        >
          <MaterialIcons name="restore" size={18} color="black" />
        </Pressable>
        <Pressable
          onPress={handleDelete}
          className="rounded-lg border border-red-800 bg-red-700 px-4 py-2.5 active:bg-red-900"
        >
          <MaterialIcons name="delete-forever" size={18} color="white" />
        </Pressable>
      </View>
    </View>
  );
}

export function Trash() {
  const queryClient = useQueryClient();

  const trashedQuery = useQuery({
    queryKey: ['trashedDocuments'],
    queryFn: readTrashedDocs,
  });

  const restoreMutation = useMutation({
    mutationFn: (uri: string) => restoreDocument(uri),
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (uri: string) => permanentlyDeleteDocument(uri),
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });

  const items = trashedQuery.data ?? [];

  return (
    <View className="flex-1 pt-safe px-safe">
      <View className="border-b border-gray-300 px-6 pb-4 pt-2">
        <Text className="text-2xl font-bold text-black">Trash</Text>
      </View>

      {items.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-base text-gray-600">
            Trash is empty.{'\n'}Deleted notes appear here for 7 days.
          </Text>
        </View>
      ) : (
        <ScrollView>
          {items.map((item) => (
            <TrashedItem
              key={item.uri}
              item={item}
              onRestore={() => restoreMutation.mutate(item.uri)}
              onDelete={() => deleteMutation.mutate(item.uri)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
