import AsyncStorage from '@react-native-async-storage/async-storage';
import { atomWithStorage, createJSONStorage } from 'jotai/utils';

const arrayStorage = createJSONStorage<string[]>(() => AsyncStorage);

/**
 * List of downloaded model language tags.
 * Persisted in AsyncStorage.
 */
export const downloadedModelsAtom = atomWithStorage<string[]>(
  'recognition_downloaded_models',
  [],
  arrayStorage,
);
