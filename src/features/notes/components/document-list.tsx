import { LegendList } from '@legendapp/list/react-native';
import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Path, Svg } from 'react-native-svg';

import type { DocumentInfo } from '@/features/storage/types';
import { formatDisplayName } from '@/features/storage/utilities/naming';
import {
  clearSavedFolderUri,
  getSavedFolderUri,
  listDocuments,
} from '@/features/storage/utilities/storage';
import {
  getTrashedUris,
  purgeExpiredTrash,
  trashDocument,
} from '@/features/storage/utilities/trash';
import { parseSvgDocument } from '@/features/svg/utilities/svg-parser';
import { pointsToPathD } from '@/features/svg/utilities/svg-serializer';

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

  const trashedQuery = useQuery({
    queryKey: ['trashedUris'],
    queryFn: getTrashedUris,
  });

  // Redirect to folder picker when no folder is saved.
  // Checked after query settles to avoid redirecting on initial load.
  if (folderQuery.isSuccess && !folderUri) {
    router.replace('/folder-picker');
  }

  // Redirect to folder picker when folder access fails (e.g. permission revoked).
  if (documentsQuery.isError) {
    clearSavedFolderUri();
    router.replace('/folder-picker');
  }

  // Filter out trashed documents from the main list.
  const trashedUris = trashedQuery.data;
  const documents = useMemo(() => {
    const allDocs = documentsQuery.data ?? [];
    if (!trashedUris || trashedUris.size === 0) return allDocs;
    return allDocs.filter((doc) => !trashedUris.has(doc.uri));
  }, [documentsQuery.data, trashedUris]);

  const trashMutation = useMutation({
    mutationFn: ({ uri, filename }: { uri: string; filename: string }) =>
      trashDocument(uri, filename),
  });

  const handleNewDocument = () => {
    if (!folderUri) return;
    router.push({ pathname: '/canvas', params: { folderUri } });
  };

  const handleTrashDocument = (doc: DocumentInfo) => {
    Alert.alert('Move to Trash?', 'This note will be permanently deleted after 7 days.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Move to Trash',
        style: 'destructive',
        onPress: () => trashMutation.mutate({ uri: doc.uri, filename: doc.filename }),
      },
    ]);
  };

  return {
    documents,
    isLoading: folderQuery.isLoading || documentsQuery.isLoading,
    isRefetching: documentsQuery.isRefetching,
    handleNewDocument,
    handleTrashDocument,
  };
}

/** Canvas dimensions — must match DrawingCanvasView. */
const CANVAS_WIDTH = 1872;
const CANVAS_HEIGHT = 2404;
const THUMBNAIL_ASPECT_RATIO = CANVAS_WIDTH / CANVAS_HEIGHT;

function NoteThumbnail({ svgContent }: { svgContent: string }) {
  const strokes = useMemo(() => parseSvgDocument(svgContent).strokes, [svgContent]);

  if (strokes.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-100">
        <Text className="text-sm text-gray-600">Empty</Text>
      </View>
    );
  }

  return (
    <Svg viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} width="100%" height="100%">
      {strokes.map((stroke, i) => (
        <Path
          // biome-ignore lint/suspicious/noArrayIndexKey: static array from parsed SVG, never reordered
          key={i}
          d={pointsToPathD(stroke)}
          stroke={stroke.color}
          strokeWidth={stroke.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </Svg>
  );
}

function NoteCard({
  item,
  loading,
  onPress,
  onLongPress,
}: {
  item: DocumentInfo;
  loading?: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} className="flex-1">
      <View className="overflow-hidden rounded-lg border border-gray-300 bg-white">
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

export function DocumentList() {
  const { documents, isLoading, isRefetching, handleNewDocument, handleTrashDocument } =
    useDocumentList();

  const handleOpenDocument = (doc: DocumentInfo) => {
    router.push({ pathname: '/canvas', params: { fileUri: doc.uri } });
  };

  const renderItem = ({ item }: { item: DocumentInfo }) => {
    return (
      <NoteCard
        item={item}
        loading={isRefetching}
        onPress={() => handleOpenDocument(item)}
        onLongPress={() => handleTrashDocument(item)}
      />
    );
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center pt-safe px-safe">
        <Text className="text-base text-gray-600">Loading...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 p-safe">
      <View className="border-b border-gray-300 px-6 pb-4 pt-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-bold text-black">Notes</Text>
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
          numColumns={4}
          columnWrapperStyle={{ gap: 8 }}
          contentContainerStyle={{ padding: 12 }}
          estimatedItemSize={200}
        />
      )}
    </View>
  );
}
