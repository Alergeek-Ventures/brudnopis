import AsyncStorage from '@react-native-async-storage/async-storage';
import { atomWithStorage, createJSONStorage } from 'jotai/utils';

const storage = createJSONStorage<string>(() => AsyncStorage);
const arrayStorage = createJSONStorage<string[]>(() => AsyncStorage);

/**
 * Active language for recognition (BCP-47 tag, e.g. "en-US").
 * Persisted in AsyncStorage. Defaults to "en-US".
 */
export const activeLanguageAtom = atomWithStorage('recognition_active_language', 'en-US', storage);

/**
 * List of downloaded model language tags.
 * Persisted in AsyncStorage.
 */
export const downloadedModelsAtom = atomWithStorage<string[]>(
  'recognition_downloaded_models',
  [],
  arrayStorage,
);
