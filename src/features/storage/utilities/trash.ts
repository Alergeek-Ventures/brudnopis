import AsyncStorage from '@react-native-async-storage/async-storage';

import type { TrashedDocument } from '../types/trashed-document';
import {
  deleteDocument,
  emptyTrashFolder,
  getSavedFolderUri,
  moveDocumentFromTrash,
  moveDocumentToTrash,
} from './storage';

const TRASHED_DOCS_KEY = 'trashed_documents';

/** 7 days in milliseconds. */
export const TRASH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── AsyncStorage metadata helpers ──────────────────────────────

async function readTrashedMeta(): Promise<TrashedDocument[]> {
  const raw = await AsyncStorage.getItem(TRASHED_DOCS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as TrashedDocument[];
  } catch {
    return [];
  }
}

async function writeTrashedMeta(docs: TrashedDocument[]): Promise<void> {
  await AsyncStorage.setItem(TRASHED_DOCS_KEY, JSON.stringify(docs));
}

// ── Helpers ────────────────────────────────────────────────────

async function requireFolderUri(): Promise<string> {
  const uri = await getSavedFolderUri();
  if (!uri) throw new Error('No folder URI saved');
  return uri;
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Move a document to .trash and record metadata.
 */
export async function trashDocument(uri: string, filename: string): Promise<void> {
  const folderUri = await requireFolderUri();
  const trashUri = await moveDocumentToTrash(folderUri, uri, filename);

  const docs = await readTrashedMeta();
  docs.push({ uri: trashUri, filename, deletedAt: Date.now() });
  await writeTrashedMeta(docs);
}

/**
 * Restore a document from .trash back to the parent folder.
 */
export async function restoreDocument(trashFileUri: string, filename: string): Promise<void> {
  const folderUri = await requireFolderUri();
  await moveDocumentFromTrash(folderUri, trashFileUri, filename);

  const docs = await readTrashedMeta();
  await writeTrashedMeta(docs.filter((d) => d.uri !== trashFileUri));
}

/**
 * Read the list of trashed documents (metadata + URI in .trash folder).
 */
export async function readTrashedDocs(): Promise<TrashedDocument[]> {
  return readTrashedMeta();
}

/**
 * Permanently delete all trashed documents and clear metadata.
 */
export async function emptyTrash(): Promise<void> {
  const folderUri = await requireFolderUri();
  await emptyTrashFolder(folderUri);
  await writeTrashedMeta([]);
}

/**
 * Purge expired items — permanently delete files older than 7 days.
 * Call on app startup. Safe to call multiple times.
 */
export async function purgeExpiredTrash(): Promise<void> {
  const docs = await readTrashedMeta();
  const now = Date.now();
  const expired = docs.filter((d) => now - d.deletedAt >= TRASH_TTL_MS);
  const remaining = docs.filter((d) => now - d.deletedAt < TRASH_TTL_MS);

  await Promise.allSettled(expired.map((d) => deleteDocument(d.uri)));
  await writeTrashedMeta(remaining);
}
