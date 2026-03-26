import type { DrawingCanvasRef, NativeStrokeData } from 'drawing-canvas';
import { refreshScreen } from 'drawing-canvas';
import type { MutableRefObject } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { type ActorRefFrom, assign, fromCallback, fromPromise, setup, stateIn } from 'xstate';
import { createDocument, loadDocument, saveDocument } from '@/features/storage/utilities/storage';
import type { BackgroundPattern, Stroke, StrokeStyle } from '@/features/svg/types';
import { decodePoints, encodePoints } from '@/features/svg/utilities/points';
import { parseSvgDocument } from '@/features/svg/utilities/svg-parser';
import { serializeSvgDocument } from '@/features/svg/utilities/svg-serializer';

// ── Constants ──────────────────────────────────────────────────

const SAVE_DEBOUNCE_MS = 1000;

// ── Types ──────────────────────────────────────────────────────

type NoteMachineContext = {
  /** SAF URI of the document. Null until the first save for new notes. */
  fileUri: string | null;
  /** SAF URI of the folder (used to create the file on first save). */
  folderUri: string | null;
  width: number;
  height: number;
  backgroundPattern: BackgroundPattern;
  strokesRef: MutableRefObject<Stroke[]>;
  canvasRef: MutableRefObject<DrawingCanvasRef | null>;
  /** Strokes parsed from SVG, held between loading and restoring states. */
  loadedStrokes: Stroke[];
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
 * Two paths based on whether the SurfaceView surface was destroyed:
 * - Surface survived (e.g. notification shade): bitmap is intact, so we
 *   skip the expensive loadStrokes redraw. A pauseDrawing + resumeDrawing
 *   toggle kicks the Onyx SDK back to life (same mechanism as toolbar
 *   expand/collapse). This eliminates the visible flash.
 * - Surface recreated (e.g. full app switch): bitmap is gone, so we
 *   redraw from strokesRef via loadStrokes, then open raw drawing from
 *   scratch with startDrawing (fresh OnyxHelper).
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

    if (input.surfaceRecreated) {
      // Surface was destroyed and recreated — the bitmap is gone.
      // Full redraw from strokesRef, then open raw drawing from scratch.
      if (input.strokes.length > 0) {
        const nativeStrokes: NativeStrokeData[] = input.strokes.map((s) => ({
          points: encodePoints(s.points),
          color: s.color,
          width: s.width,
          ...(s.style && { style: s.style }),
        }));
        await canvas.loadStrokes(nativeStrokes);
      }
      await canvas.startDrawing();
    } else {
      // Surface survived (e.g. notification shade) — the bitmap is intact.
      // Toggle raw drawing off/on to restore the Onyx SDK input pipeline.
      // Same mechanism as toolbar expand/collapse, which is known to work.
      await canvas.pauseDrawing();
      await canvas.resumeDrawing();
    }
  },
);

/**
 * Subscribe to React Native AppState changes and forward them as machine events.
 *
 * On Android, pulling down the notification shade triggers 'inactive' (not
 * 'background'), so both are treated as interruptions that require a
 * pause + restore cycle.
 *
 * Invoked at the root level — the subscription is active for the machine's
 * entire lifetime. States that don't handle APP_BACKGROUND / APP_FOREGROUND
 * silently ignore them.
 */
const appStateListener = fromCallback(({ sendBack }) => {
  // 'change' fires for full app switches (background/active) and on iOS for
  // inactive transitions. On Boox Android devices the notification shade does
  // NOT trigger 'change' — only 'blur'/'focus' fire.
  const changeSub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'background' || state === 'inactive') {
      sendBack({ type: 'APP_BACKGROUND' });
    } else if (state === 'active') {
      sendBack({ type: 'APP_FOREGROUND' });
    }
  });

  // Android-only: 'blur'/'focus' fire when the window loses/gains focus,
  // which includes the notification shade, permission dialogs, and split-
  // screen. These complement 'change' for cases it misses. Duplicate events
  // are harmless — the XState machine silently drops events that have no
  // transition in the current state.
  const blurSub = AppState.addEventListener('blur', () => {
    sendBack({ type: 'APP_BACKGROUND' });
  });
  const focusSub = AppState.addEventListener('focus', () => {
    sendBack({ type: 'APP_FOREGROUND' });
  });

  return () => {
    changeSub.remove();
    blurSub.remove();
    focusSub.remove();
  };
});

// ── Machine ────────────────────────────────────────────────────

export const noteMachine = setup({
  types: {
    context: {} as NoteMachineContext,
    events: {} as
      | {
          type: 'OPEN_NOTE';
          fileUri: string | null;
          folderUri: string | null;
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
      | { type: 'TOOLBAR_COLLAPSED' }
      | { type: 'APP_BACKGROUND' }
      | { type: 'APP_FOREGROUND' },
  },
  actors: {
    appStateListener,
    loadDoc,
    restoreAndStart,
    restoreCanvas,
    serializeAndSave,
    einkRefresh,
    /** Provided at runtime: refetch document list then navigate back. */
    refetchAndNavigate: fromPromise(async () => {}),
  },
  guards: {
    isBackgrounding: stateIn({ saving: 'backgrounding' }),
    isSurfaceRecreated: stateIn({ editing: { backgrounded: 'surfaceRecreated' } }),
  },
  actions: {
    assignOpenNote: assign({
      fileUri: ({ event }) => (event.type === 'OPEN_NOTE' ? event.fileUri : null),
      folderUri: ({ event }) => (event.type === 'OPEN_NOTE' ? event.folderUri : null),
      width: ({ event }) => (event.type === 'OPEN_NOTE' ? event.width : 0),
      height: ({ event }) => (event.type === 'OPEN_NOTE' ? event.height : 0),
      backgroundPattern: ({ event }) =>
        event.type === 'OPEN_NOTE' ? event.backgroundPattern : ('dotted' as BackgroundPattern),
      strokesRef: ({ context, event }) =>
        event.type === 'OPEN_NOTE' ? event.strokesRef : context.strokesRef,
      canvasRef: ({ context, event }) =>
        event.type === 'OPEN_NOTE' ? event.canvasRef : context.canvasRef,
      loadedStrokes: () => [],
    }),
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

  invoke: {
    src: 'appStateListener',
  },

  // Placeholder context — overwritten by OPEN_NOTE's assignOpenNote action
  // before the machine leaves idle. Refs are initialized lazily; the idle
  // state never reads them.
  context: () => ({
    fileUri: null,
    folderUri: null,
    width: 0,
    height: 0,
    backgroundPattern: 'dotted' as BackgroundPattern,
    // biome-ignore lint/suspicious/noExplicitAny: placeholder ref, never read in idle state
    strokesRef: { current: [] } as any,
    // biome-ignore lint/suspicious/noExplicitAny: placeholder ref, never read in idle state
    canvasRef: { current: null } as any,
    loadedStrokes: [],
  }),

  initial: 'idle',

  states: {
    idle: {
      on: {
        OPEN_NOTE: {
          target: 'loading',
          actions: 'assignOpenNote',
        },
      },
    },

    // Phase 1: Load the SVG file and wait for the native canvas surface.
    // Parallel state — both regions must reach their final states before
    // the machine proceeds to `restoring`. This eliminates the `canvasReady`
    // context flag: the state graph itself encodes readiness.
    loading: {
      type: 'parallel',
      states: {
        svg: {
          initial: 'parsing',
          states: {
            parsing: {
              invoke: {
                src: 'loadDoc',
                input: ({ context }) => ({ fileUri: context.fileUri }),
                onDone: {
                  target: 'done',
                  actions: [
                    ({ context, event }) => {
                      context.strokesRef.current = event.output.strokes;
                    },
                    assign({
                      loadedStrokes: ({ event }) => event.output.strokes,
                    }),
                  ],
                },
                onError: {
                  target: '#note.error',
                },
              },
            },
            done: {
              type: 'final',
            },
          },
        },
        canvas: {
          initial: 'waiting',
          states: {
            waiting: {
              on: {
                CANVAS_READY: {
                  target: 'ready',
                },
              },
            },
            ready: {
              type: 'final',
            },
          },
        },
      },
      onDone: {
        target: 'restoring',
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
          // Canvas ref was null despite CANVAS_READY having fired — the
          // surface may have been transiently destroyed. Wait for a new
          // CANVAS_READY and retry instead of dead-ending in error.
          target: 'waitingForCanvasRetry',
        },
      },
    },

    // Recovery state: restoring failed (canvas ref null). Wait for the
    // native surface to signal readiness again, then retry restoring.
    waitingForCanvasRetry: {
      on: {
        CANVAS_READY: {
          target: 'restoring',
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
        // Allow re-opening a different note (stops current drawing session,
        // starts fresh). Same UX as the old lifecycle machine's OPEN_NOTE
        // re-entry while in editing.
        OPEN_NOTE: {
          target: 'loading',
          actions: 'assignOpenNote',
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
            CLOSE_NOTE: {
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
            CLOSE_NOTE: {
              target: '#note.closingDirty',
            },
            APP_BACKGROUND: {
              target: '#note.saving',
              actions: ['pauseDrawing'],
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
        // Compound state tracks whether the SurfaceView surface was
        // destroyed and recreated (CANVAS_READY while backgrounded).
        backgrounded: {
          initial: 'surfaceAlive',
          states: {
            surfaceAlive: {
              on: {
                CANVAS_READY: {
                  target: 'surfaceRecreated',
                },
              },
            },
            surfaceRecreated: {},
          },
          on: {
            APP_FOREGROUND: [
              {
                // Surface was destroyed and recreated — need startDrawing
                // (fresh OnyxHelper) instead of resumeDrawing.
                guard: 'isSurfaceRecreated',
                target: 'resumingFresh',
              },
              {
                target: 'resumingPaused',
              },
            ],
          },
        },

        // Redraw bitmap from strokesRef and open raw drawing from scratch.
        // Used when the SurfaceView surface was destroyed and recreated
        // while backgrounded (fresh OnyxHelper, needs startDrawing).
        resumingFresh: {
          invoke: {
            src: 'restoreCanvas',
            input: ({ context }) => ({
              canvasRef: context.canvasRef,
              strokes: context.strokesRef.current,
              surfaceRecreated: true,
            }),
            onDone: {
              target: 'clean',
            },
            onError: {
              // Best-effort — go to clean so the user can at least close.
              target: 'clean',
            },
          },
          on: {
            // Surface destroyed again during restore — restart with the
            // fresh surface (re-enter restarts the invoke).
            CANVAS_READY: {
              target: 'resumingFresh',
              reenter: true,
            },
          },
        },

        // Redraw bitmap from strokesRef and resume paused raw drawing.
        // Used when the SurfaceView surface survived backgrounding
        // (OnyxHelper still alive, needs resumeDrawing).
        resumingPaused: {
          invoke: {
            src: 'restoreCanvas',
            input: ({ context }) => ({
              canvasRef: context.canvasRef,
              strokes: context.strokesRef.current,
              surfaceRecreated: false,
            }),
            onDone: {
              target: 'clean',
            },
            onError: {
              // Best-effort — go to clean so the user can at least close.
              target: 'clean',
            },
          },
          on: {
            // Surface was destroyed during resume — the paused OnyxHelper
            // is stale. Transition to resumingFresh (restarts the invoke
            // with startDrawing path).
            CANVAS_READY: {
              target: 'resumingFresh',
            },
          },
        },
      },
    },

    // Compound state: tracks whether APP_BACKGROUND arrived during save.
    // The invoke lives on the parent so it runs regardless of child state.
    // Child state determines the onDone/onError target via stateIn guard.
    saving: {
      initial: 'foreground',
      states: {
        foreground: {
          on: {
            APP_BACKGROUND: {
              target: 'backgrounding',
              actions: 'pauseDrawing',
            },
          },
        },
        backgrounding: {},
      },
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
            guard: 'isBackgrounding',
            target: 'editing.backgrounded',
            actions: assign({
              fileUri: ({ event }) => event.output.fileUri,
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
            guard: 'isBackgrounding',
            target: 'editing.backgrounded',
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
    // Runs AFTER saving so the SVG is on disk, and BEFORE navigation
    // so the screen has settled before the document list appears.
    // Entry stops raw drawing (idempotent) so the "Saving…" overlay
    // is visible on clean-close paths that skip closingDirty.
    stopping: {
      entry: 'stopDrawing',
      invoke: {
        src: 'einkRefresh',
        onDone: {
          target: 'navigating',
        },
        onError: {
          // Best-effort — don't block exit if refresh fails.
          target: 'navigating',
        },
      },
    },

    // Refetch the document list with fresh SVG content, then navigate
    // back. Runs as a proper state so the user stays on the canvas
    // (bitmap visible) until thumbnails are ready — no stale flash.
    navigating: {
      invoke: {
        src: 'refetchAndNavigate',
        onDone: {
          target: 'idle',
        },
        onError: {
          // Best-effort — return to idle even if refetch fails.
          target: 'idle',
        },
      },
    },

    error: {
      on: {
        CLOSE_NOTE: {
          target: 'stopping',
        },
      },
    },
  },
});

export type NoteMachine = typeof noteMachine;
export type NoteMachineActorRef = ActorRefFrom<typeof noteMachine>;
