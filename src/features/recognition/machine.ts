import { invariant } from '@epic-web/invariant';
import type { DrawingCanvasRef } from 'drawing-canvas';
import InkRecognition from 'ink-recognition';
import type { MutableRefObject } from 'react';
import { assign, fromPromise, sendTo, setup } from 'xstate';
import { loadDocument, saveDocument } from '@/features/storage/utilities/storage';
import type { BackgroundPattern, Stroke, StrokeStyle } from '@/features/svg/types';
import { insertMetadata } from '@/features/svg/utilities/metadata';
import { parseSvgDocument } from '@/features/svg/utilities/svg-parser';

import { noteMachine } from './note-machine';

// ── SVG → ML Kit conversion ───────────────────────────────────

/**
 * Extract strokes from an SVG and convert to ML Kit format: [x, y, t][][].
 */
function extractStrokesForRecognition(svg: string): [number, number, number][][] {
  const { strokes } = parseSvgDocument(svg);
  return strokes.map((stroke) =>
    stroke.points.map((p) => [p.x, p.y, p.t] as [number, number, number]),
  );
}

// ── Types ──────────────────────────────────────────────────────

export type RecognitionResult = {
  text: string;
  status: 'done' | 'error';
  error?: string;
};

type NoteLifecycleContext = {
  // Violation: React refs are stored in XState context and mutated directly in
  // the child note-machine for performance. See note-machine.ts for rationale.
  /** Current note being edited or just closed. */
  current: {
    fileUri: string | null;
    folderUri: string | null;
    lang: string;
    width: number;
    height: number;
    backgroundPattern: BackgroundPattern;
    strokesRef: MutableRefObject<Stroke[]>;
    canvasRef: MutableRefObject<DrawingCanvasRef | null>;
  } | null;
  /** Recognition results keyed by decoded file URI. */
  results: Map<string, RecognitionResult>;
  /** Transient: SVG string loaded during recognition. */
  svg: string | null;
  /** Transient: recognized text from ML Kit. */
  recognizedText: string | null;
};

// ── Actors (recognition pipeline) ──────────────────────────────

const loadForRecognition = fromPromise(async ({ input }: { input: { fileUri: string } }) => {
  return loadDocument(input.fileUri);
});

const recognize = fromPromise(async ({ input }: { input: { svg: string; lang: string } }) => {
  const strokes = extractStrokesForRecognition(input.svg);
  if (strokes.length === 0) return '';
  return InkRecognition.recognize(strokes, input.lang);
});

const persistRecognition = fromPromise(
  async ({ input }: { input: { fileUri: string; svg: string; text: string } }) => {
    const updatedSvg = insertMetadata(input.svg, input.text);
    await saveDocument(input.fileUri, updatedSvg);
  },
);

// ── Machine ────────────────────────────────────────────────────

export const noteLifecycleMachine = setup({
  types: {
    context: {} as NoteLifecycleContext,
    events: {} as
      | {
          type: 'OPEN_NOTE';
          fileUri: string | null;
          folderUri: string | null;
          lang: string;
          width: number;
          height: number;
          backgroundPattern: BackgroundPattern;
          strokesRef: MutableRefObject<Stroke[]>;
          canvasRef: MutableRefObject<DrawingCanvasRef | null>;
        }
      | { type: 'STROKE_END'; points: string; color: string; width: number; style?: StrokeStyle }
      | { type: 'ERASE_END'; indices: number[] }
      | { type: 'CANVAS_READY' }
      | { type: 'CLOSE_NOTE' }
      | { type: 'TOOLBAR_EXPANDED' }
      | { type: 'TOOLBAR_COLLAPSED' },
  },
  actors: {
    noteMachine,
    /** Provided at runtime: refetch document list then navigate back. */
    refetchAndNavigate: fromPromise(async () => {}),
    loadForRecognition,
    recognize,
    persistRecognition,
  },
  guards: {
    wasNeverSaved: ({ context }) => context.current?.fileUri == null,
    isEmptySvg: (_, params: { svg: string }) => {
      const { strokes } = parseSvgDocument(params.svg);
      return strokes.length === 0;
    },
  },
  actions: {
    /** Provided at runtime: invalidate React Query document list cache. */
    onRecognitionComplete: () => {},
    recordError: assign({
      results: ({ context }, params: { error: string }) => {
        const results = new Map(context.results);
        const uri = context.current?.fileUri;
        if (uri) {
          results.set(decodeURIComponent(uri), {
            text: '',
            status: 'error',
            error: params.error,
          });
        }
        return results;
      },
      svg: () => null as string | null,
      recognizedText: () => null as string | null,
    }),
    clearTransient: assign({
      svg: () => null as string | null,
      recognizedText: () => null as string | null,
    }),
  },
}).createMachine({
  id: 'noteLifecycle',

  context: () => ({
    current: null,
    results: new Map(),
    svg: null,
    recognizedText: null,
  }),

  initial: 'idle',

  states: {
    idle: {
      on: {
        OPEN_NOTE: {
          target: 'editing',
          actions: assign({
            current: ({ event }) => ({
              fileUri: event.fileUri,
              folderUri: event.folderUri,
              lang: event.lang,
              width: event.width,
              height: event.height,
              backgroundPattern: event.backgroundPattern,
              strokesRef: event.strokesRef,
              canvasRef: event.canvasRef,
            }),
          }),
        },
      },
    },

    editing: {
      invoke: {
        id: 'noteEditor',
        src: 'noteMachine',
        input: ({ context }) => {
          const c = context.current;
          if (!c) throw new Error('No current note in editing state');
          return {
            fileUri: c.fileUri,
            folderUri: c.folderUri,
            lang: c.lang,
            width: c.width,
            height: c.height,
            backgroundPattern: c.backgroundPattern,
            strokesRef: c.strokesRef,
            canvasRef: c.canvasRef,
          };
        },
        onDone: {
          target: 'navigating',
          actions: assign({
            current: ({ context, event }) => {
              if (!context.current) return null;
              return {
                ...context.current,
                fileUri: event.output.fileUri,
                lang: event.output.lang,
              };
            },
          }),
        },
      },
      on: {
        STROKE_END: {
          actions: sendTo('noteEditor', ({ event }) => ({
            type: 'STROKE_END' as const,
            points: event.points,
            color: event.color,
            width: event.width,
            style: event.style,
          })),
        },
        ERASE_END: {
          actions: sendTo('noteEditor', ({ event }) => ({
            type: 'ERASE_END' as const,
            indices: event.indices,
          })),
        },
        CANVAS_READY: {
          actions: sendTo('noteEditor', { type: 'CANVAS_READY' }),
        },
        CLOSE_NOTE: {
          actions: sendTo('noteEditor', { type: 'CLOSE' }),
        },
        TOOLBAR_EXPANDED: {
          actions: sendTo('noteEditor', { type: 'TOOLBAR_EXPANDED' }),
        },
        TOOLBAR_COLLAPSED: {
          actions: sendTo('noteEditor', { type: 'TOOLBAR_COLLAPSED' }),
        },
        // Allow re-opening a different note (stops current child automatically)
        OPEN_NOTE: {
          target: 'editing',
          reenter: true,
          actions: assign({
            current: ({ event }) => ({
              fileUri: event.fileUri,
              folderUri: event.folderUri,
              lang: event.lang,
              width: event.width,
              height: event.height,
              backgroundPattern: event.backgroundPattern,
              strokesRef: event.strokesRef,
              canvasRef: event.canvasRef,
            }),
          }),
        },
      },
    },

    // Refetch the document list with fresh SVG content, then navigate
    // back. Runs as a proper state so the user stays on the canvas
    // (bitmap visible) until thumbnails are ready — no stale flash.
    navigating: {
      invoke: {
        src: 'refetchAndNavigate',
        onDone: [
          {
            // Note was never saved (no strokes) — skip recognition.
            target: 'idle',
            guard: 'wasNeverSaved',
            actions: 'clearTransient',
          },
          {
            target: 'recognizing',
          },
        ],
        onError: [
          {
            target: 'idle',
            guard: 'wasNeverSaved',
            actions: 'clearTransient',
          },
          {
            // Best-effort — still proceed to recognition even if refetch fails.
            target: 'recognizing',
          },
        ],
      },
    },

    recognizing: {
      initial: 'loading',

      states: {
        loading: {
          invoke: {
            src: 'loadForRecognition',
            input: ({ context }) => {
              invariant(context.current, 'current must be set in recognizing.loading');
              invariant(context.current.fileUri, 'fileUri must be set in recognizing.loading');
              return { fileUri: context.current.fileUri };
            },
            onDone: [
              {
                // Empty or stroke-less SVG — skip recognition entirely.
                target: '#noteLifecycle.idle',
                guard: {
                  type: 'isEmptySvg',
                  params: ({ event }) => ({ svg: event.output }),
                },
                actions: 'clearTransient',
              },
              {
                target: 'processing',
                actions: assign({
                  svg: ({ event }) => event.output,
                }),
              },
            ],
            onError: {
              target: '#noteLifecycle.idle',
              actions: {
                type: 'recordError',
                params: { error: 'Failed to load document for recognition' },
              },
            },
          },
        },

        processing: {
          invoke: {
            src: 'recognize',
            input: ({ context }) => {
              invariant(context.svg, 'svg must be set in recognizing.processing');
              invariant(context.current, 'current must be set in recognizing.processing');
              return { svg: context.svg, lang: context.current.lang };
            },
            onDone: {
              target: 'persisting',
              actions: assign({
                recognizedText: ({ event }) => event.output,
              }),
            },
            onError: {
              target: '#noteLifecycle.idle',
              actions: {
                type: 'recordError',
                params: { error: 'Recognition failed' },
              },
            },
          },
        },

        persisting: {
          invoke: {
            src: 'persistRecognition',
            input: ({ context }) => {
              invariant(context.current, 'current must be set in recognizing.persisting');
              invariant(context.current.fileUri, 'fileUri must be set in recognizing.persisting');
              invariant(context.svg, 'svg must be set in recognizing.persisting');
              return {
                fileUri: context.current.fileUri,
                svg: context.svg,
                text: context.recognizedText ?? '',
              };
            },
            onDone: {
              target: '#noteLifecycle.idle',
              actions: [
                assign({
                  results: ({ context }) => {
                    const results = new Map(context.results);
                    const uri = context.current?.fileUri;
                    if (uri) {
                      results.set(decodeURIComponent(uri), {
                        text: context.recognizedText ?? '',
                        status: 'done',
                      });
                    }
                    return results;
                  },
                }),
                'clearTransient',
                { type: 'onRecognitionComplete' },
              ],
            },
            onError: {
              target: '#noteLifecycle.idle',
              actions: {
                type: 'recordError',
                params: { error: 'Failed to persist recognition result' },
              },
            },
          },
        },
      },
    },
  },
});

export type NoteLifecycleMachine = typeof noteLifecycleMachine;
