import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  readAsStringAsync,
  StorageAccessFramework,
  writeAsStringAsync,
} from 'expo-file-system/legacy';

import { extractMetadataText } from '@/features/svg/utilities/metadata';

import type { DocumentInfo } from '../types';
import { generateFilename, parseFilenameToDate } from './naming';

const FOLDER_URI_KEY = 'documents_folder_uri';

// ── Folder picker & persistence ────────────────────────────────

/**
 * Open the system folder picker and persist the selected URI.
 * Returns the directory URI on success, null if cancelled.
 * The URI grant survives app restarts (Expo calls takePersistableUriPermission internally).
 */
export async function pickFolder(initialUri?: string): Promise<string | null> {
  const result = await StorageAccessFramework.requestDirectoryPermissionsAsync(initialUri);
  if (!result.granted) return null;

  await AsyncStorage.setItem(FOLDER_URI_KEY, result.directoryUri);
  return result.directoryUri;
}

/**
 * Get the previously saved folder URI, or null if none saved.
 */
export async function getSavedFolderUri(): Promise<string | null> {
  return AsyncStorage.getItem(FOLDER_URI_KEY);
}

/**
 * Clear the saved folder URI (e.g., when changing folders).
 */
export async function clearSavedFolderUri(): Promise<void> {
  await AsyncStorage.removeItem(FOLDER_URI_KEY);
}

// ── Document listing ───────────────────────────────────────────

/**
 * Extracts the filename from a SAF content URI.
 *
 * SAF URIs from readDirectoryAsync look like:
 *   content://com.android.externalstorage.documents/tree/primary%3AFolder/document/primary%3AFolder%2Ffile.svg
 *
 * The filename is the last segment, URL-decoded.
 */
function extractFilename(uri: string): string {
  const decoded = decodeURIComponent(uri);
  const lastSlash = decoded.lastIndexOf('/');
  const lastSegment = lastSlash >= 0 ? decoded.substring(lastSlash + 1) : decoded;

  // SAF tree URIs use %2F or / as separators in the document ID.
  // After decoding, the filename may still have a path prefix like "Folder/file.svg".
  const lastPathSep = lastSegment.lastIndexOf('/');
  return lastPathSep >= 0 ? lastSegment.substring(lastPathSep + 1) : lastSegment;
}

/**
 * List all .svg documents in the given folder.
 * Returns DocumentInfo[] sorted reverse-chronological (newest first).
 * Reads each SVG in parallel to extract recognized text from <metadata>.
 */
export async function listDocuments(folderUri: string): Promise<DocumentInfo[]> {
  const uris = await StorageAccessFramework.readDirectoryAsync(folderUri);

  const svgEntries = uris
    .map((uri) => ({ uri, filename: extractFilename(uri) }))
    .filter((entry) => entry.filename.endsWith('.svg'));

  const docs = await Promise.all(
    svgEntries.map(async ({ uri, filename }) => {
      let recognizedText: string | undefined;
      try {
        const svg = await readAsStringAsync(ensureSafUriEncoded(uri));
        recognizedText = extractMetadataText(svg);
      } catch {
        // File read failed — skip metadata extraction
      }

      return {
        uri,
        filename,
        createdAt: parseFilenameToDate(filename),
        recognizedText,
      };
    }),
  );

  // Sort reverse-chronological: newest first.
  // Filenames are ISO-ish, so lexicographic reverse = chronological reverse.
  docs.sort((a, b) => b.filename.localeCompare(a.filename));

  return docs;
}

// ── Document CRUD ──────────────────────────────────────────────

/**
 * Ensure SAF document ID segments are percent-encoded.
 *
 * SAF URIs have the structure: content://authority/tree/<treeId>/document/<docId>
 * The native APIs require <treeId> and <docId> to have colons and slashes
 * percent-encoded (%3A, %2F). However, URIs may arrive decoded — e.g. when
 * passed through expo-router search params, which decode percent sequences.
 *
 * This function is idempotent: already-encoded URIs pass through unchanged
 * because they contain no literal colons or slashes in the ID segments.
 */
function ensureSafUriEncoded(uri: string): string {
  return uri.replace(
    /^(content:\/\/[^/]+\/tree\/)(.*)(\/document\/)(.*)/,
    (_match, prefix, treeId, middle, docId) => {
      const encodeId = (id: string) => id.replace(/:/g, '%3A').replace(/\//g, '%2F');
      return `${prefix}${encodeId(treeId)}${middle}${encodeId(docId)}`;
    },
  );
}

/**
 * Create a new document file in the given folder.
 * Returns the SAF URI of the created file.
 */
export async function createDocument(
  folderUri: string,
): Promise<{ uri: string; filename: string }> {
  const filename = generateFilename();
  const uri = await StorageAccessFramework.createFileAsync(folderUri, filename, 'image/svg+xml');
  return { uri, filename };
}

/**
 * Save SVG content to an existing document.
 */
export async function saveDocument(fileUri: string, svgContent: string): Promise<void> {
  const encoded = ensureSafUriEncoded(fileUri);
  await writeAsStringAsync(encoded, svgContent);
}

/**
 * Load SVG content from a document.
 */
export async function loadDocument(fileUri: string): Promise<string> {
  const encoded = ensureSafUriEncoded(fileUri);
  return readAsStringAsync(encoded);
}
