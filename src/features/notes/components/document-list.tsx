import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useAtom } from 'jotai';
import { FlatList, Pressable, Text, View } from 'react-native';

import { noteLifecycleMachineAtom } from '@/features/recognition/atoms';
import type { RecognitionResult } from '@/features/recognition/machine';
import type { DocumentInfo } from '@/features/storage/types';
import { formatDisplayName } from '@/features/storage/utilities/naming';
import {
  clearSavedFolderUri,
  createDocument,
  getSavedFolderUri,
  listDocuments,
  pickFolder,
} from '@/features/storage/utilities/storage';

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

  const changeFolderMutation = useMutation({
    mutationFn: () => pickFolder(folderUri ?? undefined),
  });

  return {
    documents: documentsQuery.data ?? [],
    isLoading: folderQuery.isLoading || documentsQuery.isLoading,
    isCreating: createMutation.isPending,
    isChangingFolder: changeFolderMutation.isPending,
    handleNewDocument,
    handleChangeFolder: () => changeFolderMutation.mutate(),
  };
}

function RecognitionStatus({
  result,
  recognizedText,
  filename,
}: {
  result: RecognitionResult | undefined;
  recognizedText: string | undefined;
  filename: string;
}) {
  // Priority: live machine result > persisted SVG metadata > filename fallback

  if (result) {
    if (result.status === 'done' && result.text) {
      return (
        <Text className="text-sm text-gray-600" numberOfLines={2}>
          {result.text}
        </Text>
      );
    }
    if (result.status === 'error') {
      return <Text className="text-sm text-red-500">Recognition failed</Text>;
    }
  }

  // No live result — show persisted text from SVG metadata
  if (recognizedText) {
    return (
      <Text className="text-sm text-gray-600" numberOfLines={2}>
        {recognizedText}
      </Text>
    );
  }

  // No text at all — show filename
  return <Text className="text-sm text-gray-500">{filename}</Text>;
}

export function DocumentList() {
  const {
    documents,
    isLoading,
    isCreating,
    isChangingFolder,
    handleNewDocument,
    handleChangeFolder,
  } = useDocumentList();

  const [snapshot] = useAtom(noteLifecycleMachineAtom);

  // Show recognition pipeline status
  const isRecognizing = snapshot.matches('recognizing');
  const recognizingFileUri = isRecognizing ? snapshot.context.current?.fileUri : null;

  const handleOpenDocument = (doc: DocumentInfo) => {
    router.push({ pathname: '/canvas', params: { fileUri: doc.uri } });
  };

  const renderItem = ({ item }: { item: DocumentInfo }) => {
    const decodedItemUri = decodeURIComponent(item.uri);

    // Check if this document is currently being recognized
    const isCurrentlyRecognizing =
      recognizingFileUri && decodeURIComponent(recognizingFileUri) === decodedItemUri;

    // Check for completed recognition results
    const result = snapshot.context.results.get(decodedItemUri);

    return (
      <Pressable
        onPress={() => handleOpenDocument(item)}
        className="border-b border-gray-200 px-6 py-5"
      >
        <View className="gap-1">
          <Text className="text-base text-gray-900">
            {item.createdAt ? formatDisplayName(item.createdAt) : item.filename}
          </Text>
          {isCurrentlyRecognizing ? (
            <Text className="text-sm text-sky-600">Recognizing...</Text>
          ) : (
            <RecognitionStatus
              result={result}
              recognizedText={item.recognizedText}
              filename={item.filename}
            />
          )}
        </View>
      </Pressable>
    );
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center pt-safe px-safe">
        <Text className="text-base text-gray-500">Loading...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 pt-safe px-safe">
      <View className="border-b border-gray-200 px-6 pb-4 pt-2">
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-bold text-gray-900">Notes</Text>
          <View className="flex-row items-center gap-3">
            <Pressable
              onPress={() => router.push('/settings')}
              className="rounded-lg bg-gray-200 px-3 py-2.5 active:bg-gray-300"
            >
              <Text className="text-sm text-gray-700">Settings</Text>
            </Pressable>
            <Pressable
              onPress={handleNewDocument}
              disabled={isCreating}
              className="rounded-lg bg-sky-700 px-5 py-2.5 active:bg-sky-800 disabled:opacity-50"
            >
              <Text className="text-sm font-semibold text-white">
                {isCreating ? 'Creating...' : 'New Note'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {documents.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="mb-6 text-center text-base leading-6 text-gray-500">
            No notes yet.{'\n'}Tap "New Note" to get started.
          </Text>
        </View>
      ) : (
        <FlatList data={documents} keyExtractor={(item) => item.uri} renderItem={renderItem} />
      )}

      <View className="border-t border-gray-200 px-6 py-3">
        <Pressable onPress={handleChangeFolder} disabled={isChangingFolder}>
          <Text className="text-center text-sm text-gray-500">
            {isChangingFolder ? 'Changing...' : 'Change Folder'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
