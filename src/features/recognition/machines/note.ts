import type { DrawingCanvasRef, NativeStrokeData } from 'drawing-canvas';
import { refreshScreen } from 'drawing-canvas';
import type { MutableRefObject } from 'react';
import { type ActorRefFrom, assign, fromPromise, setup } from 'xstate';
import { createDocument, loadDocument, saveDocument } from '@/features/storage/utilities/storage';
import type { BackgroundPattern, Stroke, StrokeStyle } from '@/features/svg/types';
import { decodePoints, encodePoints } from '@/features/svg/utilities/points';
import { parseSvgDocument } from '@/features/svg/utilities/svg-parser';
import { serializeSvgDocument } from '@/features/svg/utilities/svg-serializer';

// ── Constants ──────────────────────────────────────────────────

const SAVE_DEBOUNCE_MS = 1000;

// ── Types ──────────────────────────────────────────────────────

export type NoteMachineInput = {
  /** SAF URI of an existing document, or null for a brand-new note. */
  fileUri: string | null;
  /** SAF URI of the folder to create a new file in (required when fileUri is null). */
  folderUri: string | null;
  lang: string;
  width: number;
  height: number;
  backgroundPattern: BackgroundPattern;
  strokesRef: MutableRefObject<Stroke[]>;
  canvasRef: MutableRefObject<DrawingCanvasRef | null>;
};

type NoteMachineContext = {
  /** SAF URI of the document. Null until the first save for new notes. */
  fileUri: string | null;
  /** SAF URI of the folder (used to create the file on first save). */
  folderUri: string | null;
  lang: string;
  width: number;
  height: number;
  backgroundPattern: BackgroundPattern;
  strokesRef: MutableRefObject<Stroke[]>;
  canvasRef: MutableRefObject<DrawingCanvasRef | null>;
  /** Strokes parsed from SVG, held between loading and restoring states. */
  loadedStrokes: Stroke[];
  /** Whether the native canvas surface is created and ready for commands. */
  canvasReady: boolean;
  /** True when CANVAS_READY fires while backgrounded — surface was destroyed and recreated. */
  surfaceRecreated: boolean;
  /** True when APP_BACKGROUND arrives during saving — route to backgrounded after save completes. */
  backgroundPending: boolean;
};

export type NoteMachineOutput = {
  /** SAF URI of the document, or null if the note was never saved. */
  fileUri: string | null;
  lang: string;
};

// ── Actors (async operations) ──────────────────────────────────

const loadDoc = fromPromise(async ({ input }: { input: { fileUri: string | null } }) => {
  if (!input.fileUri) return parseSvgDocument('');
  const svg = await loadDocument(input.fileUri);
  return parseSvgDocument(svg);
});

/**
 * Restore strokes to the native canvas and start raw drawing.
 *
 * Guaranteed sequence:
 * 1. loadStrokes — renders saved strokes to the offscreen bitmap and blits
 *    to the SurfaceView. Screen is NOT frozen yet, so the e-ink panel
 *    physically displays the strokes.
 * 2. startDrawing — opens Onyx SDK raw drawing mode, freezing the screen
 *    for normal Android rendering but enabling low-latency stylus input.
 */
const restoreAndStart = fromPromise(
  async ({
    input,
  }: {
    input: {
      canvasRef: MutableRefObject<DrawingCanvasRef | null>;
      strokes: Stroke[];
    };
  }) => {
    const canvas = input.canvasRef.current;
    if (!canvas) throw new Error('Canvas ref is null during restore');

    if (input.strokes.length > 0) {
      const nativeStrokes: NativeStrokeData[] = input.strokes.map((s) => ({
        points: encodePoints(s.points),
        color: s.color,
        width: s.width,
        // Only include style when defined — sending undefined through the
        // Expo Modules bridge into Kotlin Map<String, Any> can cause issues
        // since Any is non-nullable.
        ...(s.style && { style: s.style }),
      }));
      await canvas.loadStrokes(nativeStrokes);
    }

    await canvas.startDrawing();
  },
);

const serializeAndSave = fromPromise(
  async ({
    input,
  }: {
    input: {
      fileUri: string | null;
      folderUri: string | null;
      strokesRef: MutableRefObject<Stroke[]>;
      width: number;
      height: number;
      backgroundPattern: BackgroundPattern;
    };
  }): Promise<{ fileUri: string }> => {
    console.debug(
      `[note:serializeAndSave] strokes=${input.strokesRef.current.length} fileUri=${input.fileUri ?? '(new)'}`,
    );
    const svg = serializeSvgDocument(
      input.strokesRef.current,
      input.width,
      input.height,
      input.backgroundPattern,
    );

    if (input.fileUri) {
      await saveDocument(input.fileUri, svg);
      return { fileUri: input.fileUri };
    }

    // New note — create the file on first save.
    if (!input.folderUri) throw new Error('folderUri is required to create a new document');
    const { uri } = await createDocument(input.folderUri);
    await saveDocument(uri, svg);
    return { fileUri: uri };
  },
);

/**
 * Close raw drawing and trigger a full e-ink refresh.
 *
 * Guaranteed sequence:
 * 1. stopDrawing — closes Onyx SDK raw drawing permanently, unfreezes
 *    the e-ink screen. The SurfaceView surface stays alive so the bitmap
 *    (with all strokes) remains visible.
 * 2. refreshScreen — GC waveform drives every pixel black→white,
 *    clearing any ghosting from the drawing session.
 *
 * Only after both complete does the machine transition to the final
 * `closed` state, which triggers navigation away.
 */
/**
 * Trigger a full e-ink refresh to clear ghosting from the drawing session.
 *
 * Raw drawing is already stopped by the `stopDrawing` entry action on
 * `closingDirty` / `stopping`, so we only need the GC waveform refresh here.
 */
const einkRefresh = fromPromise(async () => {
  console.debug('[note:einkRefresh] refreshing screen');
  await refreshScreen();
  console.debug('[note:einkRefresh] refreshScreen complete');
});

/**
 * Restore canvas after returning from background.
 *
 * Always redraws the bitmap from strokesRef (the e-ink panel may show
 * stale content after Android's compositor ran while backgrounded).
 *
 * Two paths based on whether the SurfaceView surface was destroyed:
 * - Surface survived: OnyxHelper still alive, was paused → resumeDrawing.
 * - Surface recreated: surfaceCreated already inited a fresh OnyxHelper
 *   and fired onReady → startDrawing (opens raw drawing from scratch).
 */
const restoreCanvas = fromPromise(
  async ({
    input,
  }: {
    input: {
      canvasRef: MutableRefObject<DrawingCanvasRef | null>;
      strokes: Stroke[];
      surfaceRecreated: boolean;
    };
  }) => {
    const canvas = input.canvasRef.current;
    if (!canvas) throw new Error('Canvas ref null during restore');

    console.debug(
      `[note:restoreCanvas] strokes=${input.strokes.length} surfaceRecreated=${input.surfaceRecreated}`,
    );

    if (input.strokes.length > 0) {
      const nativeStrokes: NativeStrokeData[] = input.strokes.map((s) => ({
        points: encodePoints(s.points),
        color: s.color,
        width: s.width,
        ...(s.style && { style: s.style }),
      }));
      await canvas.loadStrokes(nativeStrokes);
    }

    if (input.surfaceRecreated) {
      await canvas.startDrawing();
    } else {
      await canvas.resumeDrawing();
    }
  },
);

// ── Machine ────────────────────────────────────────────────────

export const noteMachine = setup({
  types: {
    context: {} as NoteMachineContext,
    input: {} as NoteMachineInput,
    output: {} as NoteMachineOutput,
    events: {} as
      | { type: 'STROKE_END'; points: string; color: string; width: number; style?: StrokeStyle }
      | { type: 'ERASE_END'; indices: number[] }
      | { type: 'CANVAS_READY' }
      | { type: 'CLOSE' }
      | { type: 'TOOLBAR_EXPANDED' }
      | { type: 'TOOLBAR_COLLAPSED' }
      | { type: 'APP_BACKGROUND' }
      | { type: 'APP_FOREGROUND' },
  },
  actors: {
    loadDoc,
    restoreAndStart,
    restoreCanvas,
    serializeAndSave,
    einkRefresh,
  },
  guards: {
    isCanvasReady: ({ context }) => context.canvasReady,
    isBackgroundPending: ({ context }) => context.backgroundPending,
  },
  actions: {
    // Violation: Imperative ref mutations bypass XState's assign semantics.
    // Rationale: strokesRef mutates on every stylus stroke-end. Using assign
    // would trigger snapshot updates and React re-renders for data that is
    // only consumed during serialization (save). Refs keep drawing fast.
    addStroke: ({ context, event }) => {
      if (event.type !== 'STROKE_END') return;
      const points = decodePoints(event.points);
      if (points.length === 0) return;
      context.strokesRef.current.push({
        points,
        color: event.color,
        width: event.width,
        ...(event.style && event.style !== 'pencil' && { style: event.style }),
      });
      console.debug(
        `[note:addStroke] +1 stroke (${points.length} pts), total=${context.strokesRef.current.length}`,
      );
    },
    // Violation: Same as addStroke — imperative ref mutation for performance.
    eraseStrokes: ({ context, event }) => {
      if (event.type !== 'ERASE_END') return;
      const indicesToRemove = new Set(event.indices);
      const before = context.strokesRef.current.length;
      context.strokesRef.current = context.strokesRef.current.filter(
        (_, i) => !indicesToRemove.has(i),
      );
      console.debug(
        `[note:eraseStrokes] removed=${before - context.strokesRef.current.length}, total=${context.strokesRef.current.length}`,
      );
    },
    pauseDrawing: ({ context }) => {
      context.canvasRef.current?.pauseDrawing();
    },
    resumeDrawing: ({ context }) => {
      context.canvasRef.current?.resumeDrawing();
    },
    // Permanently close raw drawing and unfreeze the e-ink screen so
    // React Native UI updates (e.g. "Saving…" overlay) become visible.
    stopDrawing: ({ context }) => {
      console.debug('[note:stopDrawing] unfreezing screen for close overlay');
      context.canvasRef.current?.stopDrawing();
    },
  },
}).createMachine({
  id: 'note',

  context: ({ input }) => ({
    fileUri: input.fileUri,
    folderUri: input.folderUri,
    lang: input.lang,
    width: input.width,
    height: input.height,
    backgroundPattern: input.backgroundPattern,
    strokesRef: input.strokesRef,
    canvasRef: input.canvasRef,
    loadedStrokes: [],
    canvasReady: false,
    surfaceRecreated: false,
    backgroundPending: false,
  }),

  initial: 'loading',

  output: ({ context }) => ({
    fileUri: context.fileUri,
    lang: context.lang,
  }),

  states: {
    // Phase 1: Load the SVG file and parse strokes.
    // Also accepts CANVAS_READY — the native surface may become ready
    // before or after the SVG loads.
    loading: {
      invoke: {
        src: 'loadDoc',
        input: ({ context }) => ({ fileUri: context.fileUri }),
        onDone: [
          {
            // Canvas already ready — go straight to restoring.
            target: 'restoring',
            guard: 'isCanvasReady',
            actions: [
              ({ context, event }) => {
                context.strokesRef.current = event.output.strokes;
              },
              assign({
                loadedStrokes: ({ event }) => event.output.strokes,
              }),
            ],
          },
          {
            // Canvas not ready yet — wait for it.
            target: 'waitingForCanvas',
            actions: [
              ({ context, event }) => {
                context.strokesRef.current = event.output.strokes;
              },
              assign({
                loadedStrokes: ({ event }) => event.output.strokes,
              }),
            ],
          },
        ],
        onError: {
          target: 'error',
        },
      },
      on: {
        CANVAS_READY: {
          actions: assign({ canvasReady: () => true }),
        },
      },
    },

    // SVG loaded but native canvas not ready yet. Wait for it.
    waitingForCanvas: {
      on: {
        CANVAS_READY: {
          target: 'restoring',
          actions: assign({ canvasReady: () => true }),
        },
      },
    },

    // Phase 2: Render loaded strokes to the native bitmap (visible on
    // e-ink because raw drawing is not active yet), then open raw drawing.
    // Full e-ink refresh on entry clears ghosting from the document list.
    restoring: {
      entry: () => {
        refreshScreen();
      },
      invoke: {
        src: 'restoreAndStart',
        input: ({ context }) => ({
          canvasRef: context.canvasRef,
          strokes: context.loadedStrokes,
        }),
        onDone: {
          target: 'editing',
        },
        onError: {
          target: 'error',
        },
      },
    },

    editing: {
      initial: 'clean',

      // Toolbar expand/collapse pauses/resumes raw drawing so that
      // overlay views (color pickers, width selectors) receive touch
      // events while the toolbar is open. Handled at the editing level
      // so both clean and dirty sub-states respond.
      on: {
        TOOLBAR_EXPANDED: {
          actions: 'pauseDrawing',
        },
        TOOLBAR_COLLAPSED: {
          actions: 'resumeDrawing',
        },
      },

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
              target: '#note.stopping',
            },
            APP_BACKGROUND: {
              target: 'backgrounded',
              actions: 'pauseDrawing',
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
              target: '#note.closingDirty',
            },
            APP_BACKGROUND: {
              target: '#note.saving',
              actions: ['pauseDrawing', assign({ backgroundPending: () => true })],
            },
          },
          after: {
            [SAVE_DEBOUNCE_MS]: {
              target: '#note.saving',
            },
          },
        },

        // App went to background. Raw drawing is paused — OnyxHelper
        // stays alive but the SDK no longer captures stylus input.
        // If the SurfaceView surface is destroyed while here, Android
        // fires surfaceDestroyed (nulls OnyxHelper) then surfaceCreated
        // (fresh OnyxHelper + onReady), which arrives as CANVAS_READY.
        backgrounded: {
          on: {
            CANVAS_READY: {
              actions: assign({ surfaceRecreated: () => true }),
            },
            APP_FOREGROUND: {
              target: 'resuming',
            },
          },
        },

        // Redraw bitmap from strokesRef and re-establish raw drawing.
        // Branches on surfaceRecreated: startDrawing (fresh helper)
        // vs resumeDrawing (paused helper).
        resuming: {
          invoke: {
            src: 'restoreCanvas',
            input: ({ context }) => ({
              canvasRef: context.canvasRef,
              strokes: context.strokesRef.current,
              surfaceRecreated: context.surfaceRecreated,
            }),
            onDone: {
              target: 'clean',
              actions: assign({
                surfaceRecreated: () => false,
                backgroundPending: () => false,
              }),
            },
            onError: {
              // Best-effort — go to clean so the user can at least close.
              target: 'clean',
              actions: assign({
                surfaceRecreated: () => false,
                backgroundPending: () => false,
              }),
            },
          },
          // Edge case: surface recreated WHILE restoreCanvas is running
          // (e.g. rapid background/foreground cycling). The invoke will
          // fail because the canvas ref points at a stale surface.
          // CANVAS_READY marks that a fresh surface exists, so the next
          // attempt (via onError → clean → user draws → …) works.
          on: {
            CANVAS_READY: {
              actions: assign({ surfaceRecreated: () => true }),
            },
          },
        },
      },
    },
    saving: {
      on: {
        // Strokes arriving mid-save cancel the in-flight save (exiting
        // the state stops the invoke) and go back to dirty, where the
        // debounce timer re-saves with the complete stroke set.
        STROKE_END: {
          target: 'editing.dirty',
          actions: 'addStroke',
        },
        ERASE_END: {
          target: 'editing.dirty',
          actions: 'eraseStrokes',
        },
        APP_BACKGROUND: {
          actions: ['pauseDrawing', assign({ backgroundPending: () => true })],
        },
      },
      invoke: {
        src: 'serializeAndSave',
        input: ({ context }) => ({
          fileUri: context.fileUri,
          folderUri: context.folderUri,
          strokesRef: context.strokesRef,
          width: context.width,
          height: context.height,
          backgroundPattern: context.backgroundPattern,
        }),
        onDone: [
          {
            guard: 'isBackgroundPending',
            target: 'editing.backgrounded',
            actions: assign({
              fileUri: ({ event }) => event.output.fileUri,
              backgroundPending: () => false,
            }),
          },
          {
            target: 'editing.clean',
            actions: assign({
              fileUri: ({ event }) => event.output.fileUri,
            }),
          },
        ],
        onError: [
          {
            guard: 'isBackgroundPending',
            target: 'editing.backgrounded',
            actions: assign({ backgroundPending: () => false }),
          },
          {
            target: 'editing.dirty',
          },
        ],
      },
    },

    // Wait for late-arriving strokes before flushing to disk.
    // Each stroke resets the timer. After 1s of silence, flush.
    // Entry stops raw drawing so the e-ink screen unfreezes and the
    // "Saving…" overlay becomes visible immediately.
    closingDirty: {
      entry: 'stopDrawing',
      on: {
        STROKE_END: {
          target: 'closingDirty',
          reenter: true,
          actions: 'addStroke',
        },
        ERASE_END: {
          target: 'closingDirty',
          reenter: true,
          actions: 'eraseStrokes',
        },
      },
      after: {
        [SAVE_DEBOUNCE_MS]: {
          target: 'flushing',
        },
      },
    },

    flushing: {
      invoke: {
        src: 'serializeAndSave',
        input: ({ context }) => ({
          fileUri: context.fileUri,
          folderUri: context.folderUri,
          strokesRef: context.strokesRef,
          width: context.width,
          height: context.height,
          backgroundPattern: context.backgroundPattern,
        }),
        onDone: {
          target: 'stopping',
          actions: assign({
            fileUri: ({ event }) => event.output.fileUri,
          }),
        },
        onError: {
          // Best-effort save — still stop drawing and close cleanly.
          target: 'stopping',
        },
      },
    },

    // Phase 3: Close raw drawing and refresh the e-ink display.
    // Runs AFTER saving so the SVG is on disk, and BEFORE the final
    // state so navigation only happens once the screen has settled.
    // Entry stops raw drawing (idempotent) so the "Saving…" overlay
    // is visible on clean-close paths that skip closingDirty.
    stopping: {
      entry: 'stopDrawing',
      invoke: {
        src: 'einkRefresh',
        onDone: {
          target: 'closed',
        },
        onError: {
          // Best-effort — don't block exit if refresh fails.
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
          target: 'stopping',
        },
      },
    },
  },
});

export type NoteMachine = typeof noteMachine;
export type NoteMachineActorRef = ActorRefFrom<typeof noteMachine>;
