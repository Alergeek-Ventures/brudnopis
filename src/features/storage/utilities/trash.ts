import AsyncStorage from '@react-native-async-storage/async-storage';

import type { TrashedDocument } from '../atoms';
import { deleteDocument } from './storage';

const TRASHED_DOCS_KEY = 'trashed_documents';

/** 7 days in milliseconds. */
const TRASH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── AsyncStorage helpers ───────────────────────────────────────

async function readTrashedDocs(): Promise<TrashedDocument[]> {
  const raw = await AsyncStorage.getItem(TRASHED_DOCS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as TrashedDocument[];
  } catch {
    return [];
  }
}

async function writeTrashedDocs(docs: TrashedDocument[]): Promise<void> {
  await AsyncStorage.setItem(TRASHED_DOCS_KEY, JSON.stringify(docs));
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Move a document to the trash.
 * The file stays on disk — only the metadata record is added.
 */
export async function trashDocument(uri: string, filename: string): Promise<void> {
  const docs = await readTrashedDocs();

  // Avoid duplicates (same URI trashed twice).
  if (docs.some((d) => d.uri === uri)) return;

  docs.push({ uri, filename, deletedAt: Date.now() });
  await writeTrashedDocs(docs);
}

/**
 * Restore a document from the trash.
 * Removes the metadata record — the file is still on disk and will
 * reappear in the main document list.
 */
export async function restoreDocument(uri: string): Promise<void> {
  const docs = await readTrashedDocs();
  await writeTrashedDocs(docs.filter((d) => d.uri !== uri));
}

/**
 * Permanently delete a document — removes the file from disk
 * and the record from the trash list.
 */
export async function permanentlyDeleteDocument(uri: string): Promise<void> {
  try {
    await deleteDocument(uri);
  } catch {
    // File may already be gone (e.g. user deleted via file manager).
  }
  const docs = await readTrashedDocs();
  await writeTrashedDocs(docs.filter((d) => d.uri !== uri));
}

/**
 * Purge expired items from the trash — permanently delete files
 * older than 7 days.
 *
 * Call this on app startup. Safe to call multiple times.
 */
export async function purgeExpiredTrash(): Promise<void> {
  const docs = await readTrashedDocs();
  const now = Date.now();
  const expired = docs.filter((d) => now - d.deletedAt >= TRASH_TTL_MS);
  const remaining = docs.filter((d) => now - d.deletedAt < TRASH_TTL_MS);

  // Delete expired files from disk (best-effort, don't block on individual failures).
  await Promise.allSettled(expired.map((d) => deleteDocument(d.uri)));

  await writeTrashedDocs(remaining);
}

/**
 * Get the set of trashed URIs for filtering the document list.
 */
export async function getTrashedUris(): Promise<Set<string>> {
  const docs = await readTrashedDocs();
  return new Set(docs.map((d) => d.uri));
}
