import { useMutation } from '@tanstack/react-query';
import InkRecognition from 'ink-recognition';
import { useAtom } from 'jotai';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { activeLanguageAtom } from '@/features/settings/atoms/active-language';
import { downloadedModelsAtom } from '@/features/settings/atoms/downloaded-models';
import { pickFolder } from '@/features/storage/utilities/storage';

type Language = {
  tag: string;
  name: string;
};

const AVAILABLE_LANGUAGES: Language[] = [
  { tag: 'en-US', name: 'English (US)' },
  { tag: 'pl-PL', name: 'Polish' },
];

function LanguageRow({
  language,
  isDownloaded,
  isActive,
  onDownload,
  onDelete,
  onSetActive,
}: {
  language: Language;
  isDownloaded: boolean;
  isActive: boolean;
  onDownload: () => Promise<void>;
  onDelete: () => Promise<void>;
  onSetActive: () => void;
}) {
  const [isLoading, setIsLoading] = useState(false);

  const handleDownload = async () => {
    setIsLoading(true);
    try {
      await onDownload();
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    setIsLoading(true);
    try {
      await onDelete();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View className="flex-row items-center justify-between border-b border-gray-300 px-6 py-4">
      <Pressable onPress={isDownloaded ? onSetActive : undefined} className="flex-1">
        <Text className="text-base text-black">{language.name}</Text>
        <Text className="mt-0.5 text-sm text-gray-600">{language.tag}</Text>
      </Pressable>

      <View className="flex-row items-center gap-3">
        {isActive ? <Text className="text-sm font-semibold text-sky-700">Active</Text> : null}

        {isLoading ? (
          <Text className="text-sm text-gray-600">Loading...</Text>
        ) : isDownloaded ? (
          <Pressable
            onPress={handleDelete}
            disabled={isActive}
            className="rounded-lg bg-gray-200 px-3 py-1.5 active:bg-gray-300 disabled:opacity-30"
          >
            <Text className="text-sm text-black">Delete</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleDownload}
            className="rounded-lg bg-sky-700 px-3 py-1.5 active:bg-sky-900"
          >
            <Text className="text-sm font-semibold text-white">Download</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function Settings() {
  const [activeLanguage, setActiveLanguage] = useAtom(activeLanguageAtom);
  const [downloadedModels, setDownloadedModels] = useAtom(downloadedModelsAtom);
  const changeFolderMutation = useMutation({
    mutationFn: () => pickFolder(),
  });

  const handleDownload = async (tag: string) => {
    await InkRecognition.downloadModel(tag);
    const updated = [...downloadedModels, tag];
    setDownloadedModels(updated);

    // If no active language yet, set this one
    if (!downloadedModels.length) {
      setActiveLanguage(tag);
    }
  };

  const handleDelete = async (tag: string) => {
    await InkRecognition.deleteModel(tag);
    const updated = downloadedModels.filter((t) => t !== tag);
    setDownloadedModels(updated);

    // If we deleted the active language, switch to first available
    if (activeLanguage === tag && updated.length > 0) {
      setActiveLanguage(updated[0]);
    }
  };

  return (
    <View className="flex-1 pt-safe px-safe">
      <View className="border-b border-gray-300 px-6 pb-4 pt-2">
        <Text className="text-2xl font-bold text-black">Settings</Text>
      </View>

      <View className="mt-4">
        <Text className="px-6 pb-2 text-sm font-semibold uppercase tracking-wide text-gray-600">
          Handwriting Recognition Languages
        </Text>
        {AVAILABLE_LANGUAGES.map((lang) => (
          <LanguageRow
            key={lang.tag}
            language={lang}
            isDownloaded={downloadedModels.includes(lang.tag)}
            isActive={activeLanguage === lang.tag}
            onDownload={() => handleDownload(lang.tag)}
            onDelete={() => handleDelete(lang.tag)}
            onSetActive={() => setActiveLanguage(lang.tag)}
          />
        ))}
      </View>

      <View className="mt-4 px-6">
        <Text className="text-sm text-gray-600">
          Tap a downloaded language to set it as active. The active language is used for handwriting
          recognition when you close a note.
        </Text>
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
