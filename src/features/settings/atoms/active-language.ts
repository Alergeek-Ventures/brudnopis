import AsyncStorage from '@react-native-async-storage/async-storage';
import { atomWithStorage, createJSONStorage } from 'jotai/utils';

const storage = createJSONStorage<string>(() => AsyncStorage);

/**
 * Active language for recognition (BCP-47 tag, e.g. "en-US").
 * Persisted in AsyncStorage. Defaults to "en-US".
 */
export const activeLanguageAtom = atomWithStorage('recognition_active_language', 'en-US', storage);
