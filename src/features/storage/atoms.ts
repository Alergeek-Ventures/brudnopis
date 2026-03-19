import AsyncStorage from '@react-native-async-storage/async-storage';
import { atomWithStorage, createJSONStorage } from 'jotai/utils';

/** A document that has been moved to the trash. */
export type TrashedDocument = {
  /** SAF content URI. */
  uri: string;
  /** Original filename for display. */
  filename: string;
  /** Unix timestamp (ms) when the document was trashed. */
  deletedAt: number;
};

const trashedDocsStorage = createJSONStorage<TrashedDocument[]>(() => AsyncStorage);

/**
 * List of trashed documents.
 * Persisted in AsyncStorage. Items older than 7 days are purged on app startup.
 */
export const trashedDocumentsAtom = atomWithStorage<TrashedDocument[]>(
  'trashed_documents',
  [],
  trashedDocsStorage,
);
