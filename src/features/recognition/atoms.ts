import { router } from 'expo-router';
import type { Getter } from 'jotai';
import { queryClientAtom } from 'jotai-tanstack-query';
import { atomWithMachine } from 'jotai-xstate';

import { noteLifecycleMachine } from './machine';

// ── Note lifecycle machine (XState, backed by Jotai) ───────────

/**
 * The note lifecycle state machine atom.
 *
 * Manages the note editing lifecycle and recognition pipeline.
 * Components interact by reading snapshot state and sending events:
 *
 *   const [snapshot, send] = useAtom(noteLifecycleMachineAtom);
 *   send({ type: 'OPEN_NOTE', fileUri, lang, ... });
 *
 * Two actions are provided at init time via get(queryClientAtom):
 * - onNoteClosed: navigates back after the note editor closes
 * - onRecognitionComplete: invalidates the document list cache
 */
export const noteLifecycleMachineAtom = atomWithMachine(
  () => noteLifecycleMachine,
  (get: Getter) => {
    const queryClient = get(queryClientAtom);
    return {
      actions: {
        onNoteClosed: () => {
          router.back();
        },
        onRecognitionComplete: () => {
          queryClient.invalidateQueries({ queryKey: ['documents'] });
        },
      },
    };
  },
);
