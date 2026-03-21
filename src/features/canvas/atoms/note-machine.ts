import { router } from 'expo-router';
import type { Getter } from 'jotai';
import { queryClientAtom } from 'jotai-tanstack-query';
import { atomWithMachine } from 'jotai-xstate';
import { fromPromise } from 'xstate';

import { noteMachine } from '../machines/note';

// ── Debug inspector ────────────────────────────────────────────
// DO NOT REMOVE — used to debug XState machines at runtime.
// Uncomment `inspect: _debugInspector` in atomWithMachine below to enable.

// biome-ignore lint/suspicious/noExplicitAny: debug-only inspector
function safeStringify(obj: any): string {
  try {
    return JSON.stringify(obj);
  } catch {
    // Cyclical or non-serializable — extract what we can.
    if (obj && typeof obj === 'object') {
      const type = obj.type ?? '?';
      const error = obj.error;
      if (error instanceof Error) return `{type:${type}, error:"${error.message}"}`;
      if (error) return `{type:${type}, error:${typeof error}}`;
      return `{type:${type}, ...}`;
    }
    return String(obj);
  }
}

// biome-ignore lint/suspicious/noExplicitAny: debug-only inspector
function _debugInspector(event: any) {
  // biome-ignore lint/suspicious/noExplicitAny: debug-only
  const id = (ref: any) => ref?.id ?? '?';

  switch (event.type) {
    case '@xstate.actor':
      console.debug(`[xstate:actor] id=${id(event.actorRef)}`);
      break;
    case '@xstate.event': {
      const src = event.sourceRef ? id(event.sourceRef) : 'external';
      const ev = event.event;
      if (ev?.error instanceof Error) {
        console.debug(
          `[xstate:event] ${src} → ${id(event.actorRef)}: ${ev.type} ERROR: ${ev.error.message}\n${ev.error.stack}`,
        );
      } else {
        console.debug(`[xstate:event] ${src} → ${id(event.actorRef)}: ${safeStringify(ev)}`);
      }
      break;
    }
    case '@xstate.snapshot': {
      const snap = event.snapshot;
      const value = snap?.value ?? snap?.status;
      const ctx = snap?.context;
      const err = snap?.error;
      let line = `[xstate:snapshot] ${id(event.actorRef)}: state=${safeStringify(value)} fileUri=${ctx?.fileUri ?? '(n/a)'} folderUri=${ctx?.folderUri ?? '(n/a)'}`;
      if (err instanceof Error) line += ` error="${err.message}"`;
      else if (err) line += ` error=${typeof err}`;
      console.debug(line);
      break;
    }
  }
}

// ── Note machine (XState, backed by Jotai) ─────────────────────

/**
 * The note state machine atom.
 *
 * Manages the full note editing lifecycle: idle → loading → editing →
 * saving → closing → navigating → idle.
 *
 * Components interact by reading snapshot state and sending events:
 *
 *   const [snapshot, send] = useAtom(noteMachineAtom);
 *   send({ type: 'OPEN_NOTE', fileUri, ... });
 *
 * Provided at init time via get(queryClientAtom):
 * - refetchAndNavigate actor: awaits document list refetch, then navigates back
 */
export const noteMachineAtom = atomWithMachine(
  () => noteMachine,
  (get: Getter) => {
    const queryClient = get(queryClientAtom);
    return {
      inspect: _debugInspector,
      actors: {
        /**
         * Refetch the document list (reads all SVGs from disk) and navigate
         * back only after fresh data is in the cache. This eliminates the
         * stale-thumbnail flash that occurred when invalidateQueries and
         * router.back() fired simultaneously.
         */
        refetchAndNavigate: fromPromise(async () => {
          await queryClient.refetchQueries({ queryKey: ['documents'] });
          router.back();
        }),
      },
    };
  },
);
