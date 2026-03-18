import { LegendList } from '@legendapp/list/react-native';
import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Path, Svg } from 'react-native-svg';

import type { DocumentInfo } from '@/features/storage/types';
import { formatDisplayName } from '@/features/storage/utilities/naming';
import {
  clearSavedFolderUri,
  createDocument,
  getSavedFolderUri,
  listDocuments,
} from '@/features/storage/utilities/storage';
import { parseSvgDocument } from '@/features/svg/utilities/svg-parser';
import { pointsToPathD } from '@/features/svg/utilities/svg-serializer';

function useDocumentList() {
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

  const createMutation = useMutation({
    mutationFn: (uri: string) => createDocument(uri),
    onSuccess: ({ uri }) => {
      router.push({ pathname: '/canvas', params: { fileUri: uri } });
    },
  });

  const handleNewDocument = () => {
    if (!folderUri || createMutation.isPending) return;
    createMutation.mutate(folderUri);
  };

  return {
    documents: documentsQuery.data ?? [],
    isLoading: folderQuery.isLoading || documentsQuery.isLoading,
    isCreating: createMutation.isPending,
    handleNewDocument,
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

function NoteCard({ item, onPress }: { item: DocumentInfo; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-1">
      <View className="overflow-hidden rounded-lg border border-gray-300 bg-white">
        <View style={{ aspectRatio: THUMBNAIL_ASPECT_RATIO }}>
          {item.svgContent ? (
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
  const { documents, isLoading, isCreating, handleNewDocument } = useDocumentList();

  const handleOpenDocument = (doc: DocumentInfo) => {
    router.push({ pathname: '/canvas', params: { fileUri: doc.uri } });
  };

  const renderItem = ({ item }: { item: DocumentInfo }) => {
    return <NoteCard item={item} onPress={() => handleOpenDocument(item)} />;
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
          <View className="flex-row items-center gap-3">
            <Pressable
              onPress={() => router.push('/settings')}
              className="rounded-lg bg-gray-200 p-2.5 active:bg-gray-300"
            >
              <MaterialIcons name="settings" size={20} color="black" />
            </Pressable>
            <Pressable
              onPress={handleNewDocument}
              disabled={isCreating}
              className="rounded-lg bg-sky-700 p-2.5 active:bg-sky-900 disabled:opacity-50"
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
