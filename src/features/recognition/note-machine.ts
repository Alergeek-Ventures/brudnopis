import type { DrawingCanvasRef, NativeStrokeData } from 'drawing-canvas';
import type { MutableRefObject } from 'react';
import { type ActorRefFrom, fromPromise, setup } from 'xstate';
import { loadDocument, saveDocument } from '@/features/storage/utilities/storage';
import type { BackgroundPattern, Stroke } from '@/features/svg/types';
import { decodePoints, encodePoints } from '@/features/svg/utilities/points';
import { parseSvgDocument } from '@/features/svg/utilities/svg-parser';
import { serializeSvgDocument } from '@/features/svg/utilities/svg-serializer';

// ── Constants ──────────────────────────────────────────────────

const SAVE_DEBOUNCE_MS = 1000;

// ── Types ──────────────────────────────────────────────────────

export type NoteMachineInput = {
  fileUri: string;
  lang: string;
  width: number;
  height: number;
  backgroundPattern: BackgroundPattern;
  strokesRef: MutableRefObject<Stroke[]>;
  canvasRef: MutableRefObject<DrawingCanvasRef | null>;
};

type NoteMachineContext = {
  fileUri: string;
  lang: string;
  width: number;
  height: number;
  backgroundPattern: BackgroundPattern;
  // Violation: React refs are stored in XState context and mutated directly in
  // actions for performance. The canvas native view owns the rendering; we only
  // keep a parallel JS-side stroke array via ref so serialization can read it
  // without an async bridge call. This makes the machine untestable in full
  // isolation — accepted trade-off for a zero-copy hot path.
  strokesRef: MutableRefObject<Stroke[]>;
  canvasRef: MutableRefObject<DrawingCanvasRef | null>;
};

export type NoteMachineOutput = {
  fileUri: string;
  lang: string;
};

// ── Actors (async operations) ──────────────────────────────────

const loadDoc = fromPromise(async ({ input }: { input: { fileUri: string } }) => {
  const svg = await loadDocument(input.fileUri);
  return parseSvgDocument(svg);
});

const serializeAndSave = fromPromise(
  async ({
    input,
  }: {
    input: {
      fileUri: string;
      strokesRef: MutableRefObject<Stroke[]>;
      width: number;
      height: number;
      backgroundPattern: BackgroundPattern;
    };
  }) => {
    const svg = serializeSvgDocument(
      input.strokesRef.current,
      input.width,
      input.height,
      input.backgroundPattern,
    );
    await saveDocument(input.fileUri, svg);
  },
);

// ── Machine ────────────────────────────────────────────────────

export const noteMachine = setup({
  types: {
    context: {} as NoteMachineContext,
    input: {} as NoteMachineInput,
    output: {} as NoteMachineOutput,
    events: {} as
      | { type: 'STROKE_END'; points: string; color: string; width: number }
      | { type: 'ERASE_END'; indices: number[] }
      | { type: 'CLOSE' },
  },
  actors: {
    loadDoc,
    serializeAndSave,
  },
  actions: {
    addStroke: ({ context, event }) => {
      if (event.type !== 'STROKE_END') return;
      const points = decodePoints(event.points);
      if (points.length === 0) return;
      context.strokesRef.current.push({
        points,
        color: event.color,
        width: event.width,
      });
    },
    eraseStrokes: ({ context, event }) => {
      if (event.type !== 'ERASE_END') return;
      const indicesToRemove = new Set(event.indices);
      context.strokesRef.current = context.strokesRef.current.filter(
        (_, i) => !indicesToRemove.has(i),
      );
    },
  },
}).createMachine({
  id: 'note',

  context: ({ input }) => ({
    fileUri: input.fileUri,
    lang: input.lang,
    width: input.width,
    height: input.height,
    backgroundPattern: input.backgroundPattern,
    strokesRef: input.strokesRef,
    canvasRef: input.canvasRef,
  }),

  initial: 'loading',

  output: ({ context }) => ({
    fileUri: context.fileUri,
    lang: context.lang,
  }),

  states: {
    loading: {
      invoke: {
        src: 'loadDoc',
        input: ({ context }) => ({ fileUri: context.fileUri }),
        onDone: {
          target: 'editing',
          actions: ({ context, event }) => {
            const { strokes } = event.output;
            context.strokesRef.current = strokes;

            const canvas = context.canvasRef.current;
            if (canvas && strokes.length > 0) {
              const nativeStrokes: NativeStrokeData[] = strokes.map((s) => ({
                points: encodePoints(s.points),
                color: s.color,
                width: s.width,
              }));
              // Violation: fire-and-forget — the native canvas handles its own
              // error state; we only need the JS-side ref (set above) for
              // serialization. A load failure here is non-fatal.
              canvas.loadStrokes(nativeStrokes).catch((error: unknown) => {
                console.warn('Failed to load strokes into native canvas:', error);
              });
            }
          },
        },
        onError: {
          target: 'error',
        },
      },
    },

    editing: {
      initial: 'clean',

      states: {
        clean: {
          on: {
            STROKE_END: {
              target: 'dirty',
              actions: 'addStroke',
            },
            ERASE_END: {
              target: 'dirty',
              actions: 'eraseStrokes',
            },
            CLOSE: {
              target: '#note.closed',
            },
          },
        },

        dirty: {
          on: {
            STROKE_END: {
              target: 'dirty',
              reenter: true,
              actions: 'addStroke',
            },
            ERASE_END: {
              target: 'dirty',
              reenter: true,
              actions: 'eraseStrokes',
            },
            CLOSE: {
              target: '#note.flushing',
            },
          },
          after: {
            [SAVE_DEBOUNCE_MS]: {
              target: '#note.saving',
            },
          },
        },
      },
    },

    saving: {
      invoke: {
        src: 'serializeAndSave',
        input: ({ context }) => ({
          fileUri: context.fileUri,
          strokesRef: context.strokesRef,
          width: context.width,
          height: context.height,
          backgroundPattern: context.backgroundPattern,
        }),
        onDone: {
          target: 'editing.clean',
        },
        onError: {
          // Save failed — go back to dirty, will retry on next timer
          target: 'editing.dirty',
        },
      },
    },

    flushing: {
      invoke: {
        src: 'serializeAndSave',
        input: ({ context }) => ({
          fileUri: context.fileUri,
          strokesRef: context.strokesRef,
          width: context.width,
          height: context.height,
          backgroundPattern: context.backgroundPattern,
        }),
        onDone: {
          target: 'closed',
        },
        onError: {
          // Best effort — don't block close
          target: 'closed',
        },
      },
    },

    closed: {
      type: 'final',
    },

    error: {
      on: {
        CLOSE: {
          target: 'closed',
        },
      },
    },
  },
});

export type NoteMachine = typeof noteMachine;
export type NoteMachineActorRef = ActorRefFrom<typeof noteMachine>;
