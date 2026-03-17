import { useEffect, useRef } from 'react';

/**
 * Returns a debounced version of the given callback.
 *
 * The returned `schedule` function is stable across renders (no useCallback needed).
 * It always invokes the latest version of `callback` after `delay` ms of inactivity.
 *
 * Also exposes:
 * - `flush()` — immediately invoke the pending callback (if dirty) and cancel the timer.
 * - `cancel()` — cancel the pending timer without invoking.
 * - `isDirty` — ref indicating whether there are unsaved changes.
 *
 * Cleanup on unmount: calls `flush()` so pending work isn't lost.
 */
export function useDebouncedCallback(callback: () => void, delay: number) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  // Stable refs — never change identity.
  const api = useRef({
    schedule() {
      dirtyRef.current = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        dirtyRef.current = false;
        callbackRef.current();
      }, delay);
    },
    flush() {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (dirtyRef.current) {
        dirtyRef.current = false;
        callbackRef.current();
      }
    },
    cancel() {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      dirtyRef.current = false;
    },
  });

  // Cleanup on unmount: flush pending work.
  useEffect(() => {
    return () => api.current.flush();
  }, []);

  return {
    schedule: api.current.schedule,
    flush: api.current.flush,
    cancel: api.current.cancel,
    isDirty: dirtyRef,
  };
}
