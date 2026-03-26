import { LegendList } from '@legendapp/list/react-native';
import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { DocumentInfo } from '@/features/storage/types';
import { formatDisplayName } from '@/features/storage/utilities/naming';
import {
  clearSavedFolderUri,
  getSavedFolderUri,
  listDocuments,
} from '@/features/storage/utilities/storage';
import { purgeExpiredTrash, trashDocument } from '@/features/storage/utilities/trash';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/types/canvas';

import { NoteThumbnail } from './note-thumbnail';

function useDocumentList() {
  // Purge expired trash items on first mount (fire-and-forget).
  useEffect(() => {
    purgeExpiredTrash();
  }, []);

  const folderQuery = useQuery({
    queryKey: ['folderUri'],
    queryFn: getSavedFolderUri,
  });

  const folderUri = folderQuery.data ?? null;

  const documentsQuery = useQuery({
    queryKey: ['documents', folderUri],
    // biome-ignore lint/style/noNonNullAssertion: guarded by enabled — queryFn only runs when folderUri is non-null
    queryFn: () => listDocuments(folderUri!),
    enabled: !!folderUri,
  });

  // Redirect flags — consumed by DocumentList to render <Redirect>.
  // Avoids calling router.replace() during render (side effect).
  const shouldRedirectNoFolder = folderQuery.isSuccess && !folderUri;
  const shouldRedirectError = documentsQuery.isError;
  const documents = documentsQuery.data ?? [];

  const trashMutation = useMutation({
    mutationFn: async (docs: { uri: string; filename: string }[]) => {
      for (const d of docs) {
        await trashDocument(d.uri, d.filename);
      }
    },
  });

  const handleNewDocument = () => {
    if (!folderUri) return;
    router.push({ pathname: '/canvas', params: { folderUri } });
  };

  const handleTrashDocuments = (docs: DocumentInfo[], onComplete?: () => void) => {
    if (docs.length === 0) return;
    trashMutation.mutate(
      docs.map((d) => ({ uri: d.uri, filename: d.filename })),
      { onSuccess: onComplete },
    );
  };

  return {
    documents,
    isLoading: folderQuery.isLoading || documentsQuery.isLoading,
    isRefetching: documentsQuery.isRefetching,
    shouldRedirectNoFolder,
    shouldRedirectError,
    handleNewDocument,
    handleTrashDocuments,
  };
}

const THUMBNAIL_ASPECT_RATIO = CANVAS_WIDTH / CANVAS_HEIGHT;

function NoteCard({
  item,
  loading,
  selected,
  onPress,
  onLongPress,
}: {
  item: DocumentInfo;
  loading?: boolean;
  selected?: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} className="flex-1">
      <View
        className={`overflow-hidden rounded-lg border ${
          selected ? 'border-sky-700 bg-sky-50' : 'border-gray-300 bg-white'
        }`}
      >
        <View style={{ aspectRatio: THUMBNAIL_ASPECT_RATIO }}>
          {loading ? (
            <View className="flex-1 items-center justify-center bg-gray-100">
              <Text className="text-sm text-gray-600">Loading...</Text>
            </View>
          ) : item.svgContent ? (
            <NoteThumbnail svgContent={item.svgContent} />
          ) : (
            <View className="flex-1 items-center justify-center bg-gray-100">
              <Text className="text-sm text-gray-600">Empty</Text>
            </View>
          )}
          {/* Selection checkbox overlay */}
          {selected != null ? (
            <View className="absolute left-1.5 top-1.5">
              <View
                className={`h-6 w-6 items-center justify-center rounded-full border-2 ${
                  selected ? 'border-sky-700 bg-sky-700' : 'border-gray-400 bg-white'
                }`}
              >
                {selected ? <MaterialIcons name="check" size={14} color="white" /> : null}
              </View>
            </View>
          ) : null}
        </View>
      </View>
      <View className="px-0.5 pt-1 pb-0.5">
        <Text className="text-xs text-gray-600" numberOfLines={1}>
          {item.createdAt ? formatDisplayName(item.createdAt) : item.filename}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Clears stale folder URI before redirecting to folder picker.
 * Violation: useEffect for AsyncStorage cleanup before redirect.
 * Rationale: clearSavedFolderUri is an async side effect that must not
 * run during render. The redirect itself is handled declaratively via <Redirect>.
 */
function RedirectAfterClear() {
  useEffect(() => {
    clearSavedFolderUri();
  }, []);
  return <Redirect href="/folder-picker" />;
}

export function DocumentList() {
  const {
    documents,
    isLoading,
    isRefetching,
    shouldRedirectNoFolder,
    shouldRedirectError,
    handleNewDocument,
    handleTrashDocuments,
  } = useDocumentList();

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

  const handleDeleteSelected = () => {
    const selected = documents.filter((d) => selectedUris.has(d.uri));
    handleTrashDocuments(selected, clearSelection);
  };

  // ── Redirects ────────────────────────────────────────────────

  if (shouldRedirectNoFolder) {
    return <Redirect href="/folder-picker" />;
  }

  if (shouldRedirectError) {
    return <RedirectAfterClear />;
  }

  // ── Card interaction ─────────────────────────────────────────

  const handleOpenDocument = (doc: DocumentInfo) => {
    router.push({ pathname: '/canvas', params: { fileUri: doc.uri } });
  };

  const handleCardPress = (doc: DocumentInfo) => {
    if (isSelecting) {
      toggleSelection(doc.uri);
    } else {
      handleOpenDocument(doc);
    }
  };

  const handleCardLongPress = (doc: DocumentInfo) => {
    toggleSelection(doc.uri);
  };

  const renderItem = ({ item }: { item: DocumentInfo }) => {
    return (
      <NoteCard
        item={item}
        loading={isRefetching}
        selected={isSelecting ? selectedUris.has(item.uri) : undefined}
        onPress={() => handleCardPress(item)}
        onLongPress={() => handleCardLongPress(item)}
      />
    );
  };

  // ── Loading ──────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center pt-safe px-safe">
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
              onPress={handleDeleteSelected}
              className="rounded-lg border border-red-800 bg-red-700 px-4 py-2.5 active:bg-red-900"
            >
              <MaterialIcons name="delete" size={20} color="white" />
            </Pressable>
          </View>
        </View>
      ) : (
        <View className="border-b border-gray-300 px-6 pb-4 pt-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-2xl font-bold text-black">Brudnopis</Text>
            <View className="flex-row items-center gap-4">
              <Pressable
                onPress={() => router.push('/settings')}
                className="rounded-lg border border-gray-400 bg-gray-200 px-4 py-2.5 active:bg-gray-300"
              >
                <MaterialIcons name="settings" size={20} color="black" />
              </Pressable>
              <Pressable
                onPress={() => router.push('/trash')}
                className="rounded-lg border border-gray-400 bg-gray-200 px-4 py-2.5 active:bg-gray-300"
              >
                <MaterialIcons name="delete" size={20} color="black" />
              </Pressable>
              <Pressable
                onPress={handleNewDocument}
                className="rounded-lg border border-sky-800 bg-sky-700 px-4 py-2.5 active:bg-sky-900"
              >
                <MaterialIcons name="add" size={22} color="white" />
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {documents.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="mb-6 text-center text-base leading-6 text-gray-600">
            No notes yet.{'\n'}Tap "New Note" to get started.
          </Text>
        </View>
      ) : (
        <LegendList
          data={documents}
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
