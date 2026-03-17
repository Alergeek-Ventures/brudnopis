import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  DrawingCanvasRef,
  EraseEndEvent,
  NativeStrokeData,
  StrokeEndEvent,
} from 'drawing-canvas';
import { type RefObject, useEffect, useRef } from 'react';

import { loadDocument, saveDocument } from '@/features/storage/utilities/storage';
import type { BackgroundPattern, Stroke } from '../types';
import { decodePoints, encodePoints } from './points';
import { parseSvgDocument } from './svg-parser';
import { serializeSvgDocument } from './svg-serializer';
import { useDebouncedCallback } from './use-debounced';

type UseDocumentOptions = {
  /** SAF URI of the document file. Required for save/load. */
  fileUri: string;
  /** Canvas width in pixels (for SVG viewBox). */
  width: number;
  /** Canvas height in pixels (for SVG viewBox). */
  height: number;
  /** Background pattern for this canvas. Saved into the SVG. */
  backgroundPattern: BackgroundPattern;
  /** Ref to the native canvas — used to push loaded strokes. */
  canvasRef: RefObject<DrawingCanvasRef | null>;
};

type UseDocumentResult = {
  /** Whether the document is currently loading from disk. */
  isLoading: boolean;
  /** Whether the document is currently saving to disk. */
  isSaving: boolean;
  /**
   * Handler for the native onStrokeEnd event.
   * Decodes the packed point string, appends to in-memory strokes,
   * and triggers a debounced save.
   */
  handleStrokeEnd: (event: StrokeEndEvent) => void;
  /**
   * Handler for the native onEraseEnd event.
   * Removes erased strokes by index from in-memory array and triggers save.
   */
  handleEraseEnd: (event: EraseEndEvent) => void;
};

const SAVE_DEBOUNCE_MS = 1000;

/**
 * Hook that manages an in-memory stroke array backed by an SVG file.
 *
 * - Load: useQuery fetches SVG from fileUri, parses strokes. A sync effect
 *   pushes them to the native canvas when data arrives.
 * - Capture: handles onStrokeEnd events, decodes points, appends to stroke array.
 * - Save: useMutation for debounced writes of serialized SVG to fileUri.
 *
 * Stroke accumulation is kept as a mutable ref since it's high-frequency
 * in-memory editing state, not async server state.
 */
export function useDocument({
  fileUri,
  width,
  height,
  backgroundPattern,
  canvasRef,
}: UseDocumentOptions): UseDocumentResult {
  // Mutable ref to avoid re-renders on every stroke.
  // Strokes are append-only during a drawing session.
  const strokesRef = useRef<Stroke[]>([]);

  // Stable refs for save closure
  const optionsRef = useRef({ fileUri, width, height, backgroundPattern });
  optionsRef.current = { fileUri, width, height, backgroundPattern };

  // ── Load ──────────────────────────────────────────────────────

  const documentQuery = useQuery({
    queryKey: ['document', fileUri],
    queryFn: async () => {
      const svg = await loadDocument(fileUri);
      const doc = parseSvgDocument(svg);
      // Empty string from a new file parses to { strokes: [], backgroundPattern: "blank" }.
      return doc;
    },
    enabled: !!fileUri,
    // Don't refetch in background — the in-memory strokesRef is the source
    // of truth once loaded. Stale query data would overwrite user edits.
    staleTime: Number.POSITIVE_INFINITY,
    // Discard cache on unmount so re-opening the same document always reads
    // from disk. The hasSyncedRef gate runs once on the first success — if
    // stale cache data were served immediately, it would sync old strokes
    // and then ignore the background refetch.
    gcTime: 0,
    retry: false,
  });

  // Sync query data to the native canvas. This is a genuine "sync external
  // system" effect — the native canvas is imperative (loadStrokes), not a
  // declarative React tree.
  const hasSyncedRef = useRef(false);
  useEffect(() => {
    if (hasSyncedRef.current) return;
    if (!documentQuery.isSuccess) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const { strokes } = documentQuery.data;
    strokesRef.current = strokes;
    hasSyncedRef.current = true;

    if (strokes.length > 0) {
      const nativeStrokes: NativeStrokeData[] = strokes.map((s) => ({
        points: encodePoints(s.points),
        color: s.color,
        width: s.width,
      }));
      // Native view may have unmounted between the query settling and this
      // effect running. Catch and ignore — the user already navigated away.
      canvas.loadStrokes(nativeStrokes).catch(() => {});
    }
  }, [documentQuery.isSuccess, documentQuery.data, canvasRef]);

  // ── Save ──────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { fileUri: uri, width: w, height: h, backgroundPattern: bg } = optionsRef.current;
      const svg = serializeSvgDocument(strokesRef.current, w, h, bg);
      await saveDocument(uri, svg);
    },
  });

  // Violation: saveMutation.mutate is accessed via ref to avoid unstable
  // useCallback dependencies. useDebouncedCallback uses a ref internally,
  // so it always calls the latest mutate without depending on its identity.
  const saveMutateRef = useRef(saveMutation.mutate);
  saveMutateRef.current = saveMutation.mutate;

  const debouncedSave = useDebouncedCallback(() => {
    saveMutateRef.current();
  }, SAVE_DEBOUNCE_MS);

  // ── Capture ───────────────────────────────────────────────────

  // Violation: useCallback is intentionally omitted. handleStrokeEnd is passed
  // to a native view (onStrokeEnd) where identity stability is not required —
  // the native bridge re-reads the prop on each event. Avoiding useCallback
  // removes the false sense of memoization and its unstable dependency chain.
  const handleStrokeEnd = (event: StrokeEndEvent) => {
    const { points: packedPoints, color, width: strokeWidth } = event.nativeEvent;

    const points = decodePoints(packedPoints);
    if (points.length === 0) return;

    const stroke: Stroke = { points, color, width: strokeWidth };
    strokesRef.current.push(stroke);
    debouncedSave.schedule();
  };

  // Same pattern as handleStrokeEnd — no useCallback needed.
  // Indices arrive sorted descending from native, so splicing in
  // order is safe (later indices removed first, earlier ones stay valid).
  const handleEraseEnd = (event: EraseEndEvent) => {
    const { indices } = event.nativeEvent;
    if (indices.length === 0) return;

    for (const index of indices) {
      strokesRef.current.splice(index, 1);
    }
    debouncedSave.schedule();
  };

  return {
    isLoading: documentQuery.isPending,
    isSaving: saveMutation.isPending,
    handleStrokeEnd,
    handleEraseEnd,
  };
}
