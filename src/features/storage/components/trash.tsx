import { LegendList } from '@legendapp/list/react-native';
import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { TrashedDocument } from '../types/trashed-document';
import { emptyTrash, readTrashedDocsWithContent, restoreDocument } from '../utilities/trash';

import { TrashCard } from './trash-card';

export function Trash() {
  const trashedQuery = useQuery({
    queryKey: ['trashedDocuments'],
    queryFn: readTrashedDocsWithContent,
  });

  const restoreMutation = useMutation({
    mutationFn: async (docs: { uri: string; filename: string }[]) => {
      for (const d of docs) {
        await restoreDocument(d.uri, d.filename);
      }
    },
  });

  const emptyTrashMutation = useMutation({
    mutationFn: emptyTrash,
  });

  const items = trashedQuery.data ?? [];

  // ── Selection state ──────────────────────────────────────────
  const [selectedUris, setSelectedUris] = useState<Set<string>>(new Set());
  const isSelecting = selectedUris.size > 0;

  const toggleSelection = (uri: string) => {
    setSelectedUris((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) {
        next.delete(uri);
      } else {
        next.add(uri);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedUris(new Set());
  };

  const handleRestoreSelected = () => {
    const selected = items.filter((d) => selectedUris.has(d.uri));
    if (selected.length === 0) return;
    restoreMutation.mutate(
      selected.map((d) => ({ uri: d.uri, filename: d.filename })),
      { onSuccess: clearSelection },
    );
  };

  // ── Render helpers ───────────────────────────────────────────

  const renderItem = ({ item }: { item: TrashedDocument }) => {
    return (
      <TrashCard
        item={item}
        selected={selectedUris.has(item.uri)}
        onPress={() => toggleSelection(item.uri)}
      />
    );
  };

  // ── Loading ──────────────────────────────────────────────────

  if (trashedQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center p-safe">
        <Text className="text-base text-gray-600">Loading...</Text>
      </View>
    );
  }

  // ── Render ───────────────────────────────────────────────────

  return (
    <View className="flex-1 p-safe">
      {/* Header: selection action bar when selecting, normal header otherwise */}
      {isSelecting ? (
        <View className="border-b border-gray-300 px-6 pb-4 pt-4">
          <View className="flex-row items-center justify-between">
            <Pressable
              onPress={clearSelection}
              className="rounded-lg border border-gray-400 bg-gray-200 px-4 py-2.5 active:bg-gray-300"
            >
              <Text className="text-sm font-medium text-black">Cancel</Text>
            </Pressable>
            <Text className="text-base font-medium text-black">{selectedUris.size} selected</Text>
            <Pressable
              onPress={handleRestoreSelected}
              className="rounded-lg border border-sky-800 bg-sky-700 px-4 py-2.5 active:bg-sky-900"
            >
              <MaterialIcons name="restore" size={20} color="white" />
            </Pressable>
          </View>
        </View>
      ) : (
        <View className="border-b border-gray-300 px-6 pb-4 pt-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-2xl font-bold text-black">Trash</Text>
            {items.length > 0 ? (
              <Pressable
                onPress={() => emptyTrashMutation.mutate()}
                className="rounded-lg border border-red-800 bg-red-700 px-4 py-2.5 active:bg-red-900"
              >
                <Text className="text-sm font-medium text-white">Empty Trash</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}

      {items.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-base text-gray-600">
            Trash is empty.{'\n'}Deleted notes appear here for 7 days.
          </Text>
        </View>
      ) : (
        <LegendList
          data={items}
          keyExtractor={(item) => item.uri}
          renderItem={renderItem}
          recycleItems
          extraData={selectedUris}
          numColumns={4}
          columnWrapperStyle={{ gap: 8 }}
          contentContainerStyle={{ padding: 12 }}
          estimatedItemSize={200}
        />
      )}
    </View>
  );
}
