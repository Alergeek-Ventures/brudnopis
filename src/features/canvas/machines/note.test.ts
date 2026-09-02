import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor, fromPromise } from 'xstate';
import type { Stroke } from '@/features/svg/types';

const storage = vi.hoisted(() => ({
  createDocument: vi.fn(),
  loadDocument: vi.fn(),
  saveDocument: vi.fn(),
}));

const mockVirtual = (path: string, factory: () => unknown) =>
  (vi.doMock as unknown as (...args: [string, () => unknown, { virtual: true }]) => void)(
    path,
    factory,
    { virtual: true },
  );

mockVirtual('@/features/storage/utilities/storage', () => storage);
mockVirtual('@/features/svg/utilities/points', () => ({
  decodePoints: () => [{ x: 0, y: 0, pressure: 1, t: 0 }],
  encodePoints: (points: unknown) => points,
}));
mockVirtual('@/features/svg/utilities/svg-parser', () => ({
  parseSvgDocument: (svg: string) => ({
    strokes: svg ? [{ points: [{ x: 0, y: 0, pressure: 1, t: 0 }], color: '#000', width: 1 }] : [],
  }),
}));
mockVirtual('@/features/svg/utilities/svg-serializer', () => ({
  serializeSvgDocument: (strokes: unknown[]) => `<svg strokes="${strokes.length}"></svg>`,
}));
vi.mock('drawing-canvas', () => ({ refreshScreen: vi.fn(() => Promise.resolve()) }));
vi.mock('react-native', () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

const { noteMachine } = await import('./note');

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};
const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const canvas = {
  loadStrokes: vi.fn(() => Promise.resolve()),
  startDrawing: vi.fn(() => Promise.resolve()),
  pauseDrawing: vi.fn(() => Promise.resolve()),
  resumeDrawing: vi.fn(() => Promise.resolve()),
  stopDrawing: vi.fn(() => Promise.resolve()),
  clear: vi.fn(() => Promise.resolve()),
};
const actors: Array<ReturnType<typeof createActor>> = [];

afterEach(() => {
  vi.useRealTimers();
  for (const actor of actors.splice(0)) actor.stop();
});

const flush = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

const startNote = async (fileUri: string | null = null, navigate = vi.fn()) => {
  const strokesRef = { current: [] as Stroke[] };
  const actor = createActor(
    noteMachine.provide({
      actors: {
        refetchAndNavigate: fromPromise(async () => {
          navigate();
        }),
      },
    }),
  ).start();
  actors.push(actor);
  actor.send({
    type: 'OPEN_NOTE',
    fileUri,
    folderUri: 'folder',
    width: 100,
    height: 100,
    backgroundPattern: 'blank',
    strokesRef,
    canvasRef: { current: canvas },
  });
  actor.send({ type: 'CANVAS_READY' });
  await flush();
  return { actor, strokesRef };
};

const stroke = (actor: ReturnType<typeof createActor>) =>
  actor.send({
    type: 'STROKE_END',
    points: '0,0,1,1',
    color: '#000',
    width: 2,
  });

describe('note persistence lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.loadDocument.mockImplementation(async (uri: string | null) =>
      uri ? '<svg>existing</svg>' : '',
    );
    storage.createDocument.mockResolvedValue({ uri: 'saf://one' });
    storage.saveDocument.mockResolvedValue(undefined);
    canvas.loadStrokes.mockResolvedValue(undefined);
    canvas.startDrawing.mockResolvedValue(undefined);
    canvas.pauseDrawing.mockResolvedValue(undefined);
    canvas.clear.mockResolvedValue(undefined);
  });

  it('allocates a new note exactly once', async () => {
    const { actor } = await startNote();
    vi.useFakeTimers();
    stroke(actor);
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.createDocument).toHaveBeenCalledTimes(1);
    expect(storage.saveDocument).toHaveBeenCalledWith('saf://one', expect.any(String));
    vi.useRealTimers();
  });

  it('keeps saving active and uses one URI for edits during allocation and write', async () => {
    const allocation = deferred<{ uri: string }>();
    const firstWrite = deferred<void>();
    storage.createDocument.mockReturnValue(allocation.promise);
    storage.saveDocument.mockReturnValueOnce(firstWrite.promise).mockResolvedValue(undefined);
    const { actor } = await startNote();
    vi.useFakeTimers();
    stroke(actor);
    vi.advanceTimersByTime(1000);
    await flush();
    stroke(actor);
    await flush();
    allocation.resolve({ uri: 'saf://same' });
    await flush();
    expect(storage.saveDocument).toHaveBeenCalledTimes(1);
    expect(storage.saveDocument.mock.calls[0][1]).toContain('strokes="2"');
    stroke(actor);
    await flush();
    firstWrite.resolve();
    await flush();
    expect(storage.createDocument).toHaveBeenCalledTimes(1);
    expect(storage.saveDocument).toHaveBeenCalledTimes(2);
    expect(storage.saveDocument.mock.calls.every(([uri]) => uri === 'saf://same')).toBe(true);
    expect(storage.saveDocument.mock.calls[1][1]).toContain('strokes="3"');
    vi.useRealTimers();
  });

  it('retains an allocated URI after failure and retries without allocation', async () => {
    storage.saveDocument.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    const { actor } = await startNote();
    vi.useFakeTimers();
    stroke(actor);
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.createDocument).toHaveBeenCalledTimes(1);
    stroke(actor);
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.createDocument).toHaveBeenCalledTimes(1);
    expect(storage.saveDocument).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('waits for the latest write before navigating on close', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    storage.saveDocument.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const navigate = vi.fn(() => Promise.resolve());
    const { actor } = await startNote('saf://existing', navigate);
    vi.useFakeTimers();
    stroke(actor);
    vi.advanceTimersByTime(1000);
    await flush();
    actor.send({ type: 'STROKE_END', points: '2,2,3,3', color: '#000', width: 2 });
    actor.send({ type: 'CLOSE_NOTE' });
    await flush();
    first.resolve();
    await flush();
    expect(navigate).not.toHaveBeenCalled();
    second.resolve();
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(actor.getSnapshot().value).toBe('idle');
    expect(navigate).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does not navigate after a close write failure and remains dirty', async () => {
    const failed = deferred<void>();
    storage.saveDocument.mockReturnValueOnce(failed.promise);
    const { actor } = await startNote('saf://existing');
    vi.useFakeTimers();
    stroke(actor);
    vi.advanceTimersByTime(1000);
    await flush();
    actor.send({ type: 'CLOSE_NOTE' });
    await flush();
    failed.reject(new Error('no space'));
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: 'dirty' });
    expect(canvas.resumeDrawing).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('closes a blank unsaved note without allocating', async () => {
    const { actor } = await startNote();
    vi.useFakeTimers();
    actor.send({ type: 'CLOSE_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.createDocument).not.toHaveBeenCalled();
    expect(storage.saveDocument).not.toHaveBeenCalled();
    expect(actor.getSnapshot().value).toBe('idle');
    vi.useRealTimers();
  });

  it('writes empty content when a persisted note is erased completely', async () => {
    storage.loadDocument.mockResolvedValue('<svg></svg>');
    const { actor } = await startNote('saf://existing');
    vi.useFakeTimers();
    actor.send({ type: 'ERASE_END', indices: [0] });
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.saveDocument).toHaveBeenCalledWith(
      'saf://existing',
      expect.stringContaining('strokes="0"'),
    );
    vi.useRealTimers();
  });

  it('resets a clean existing note in place without writing', async () => {
    const { actor, strokesRef } = await startNote('saf://existing');
    vi.useFakeTimers();
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: 'clean' });
    expect(canvas.pauseDrawing).toHaveBeenCalled();
    expect(canvas.clear).toHaveBeenCalled();
    expect(strokesRef.current).toEqual([]);
    expect(actor.getSnapshot().context.fileUri).toBeNull();
    expect(actor.getSnapshot().context.folderUri).toBe('folder');
    expect(storage.saveDocument).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('blank New is an idempotent no-op without allocation or save', async () => {
    const { actor, strokesRef } = await startNote();
    vi.useFakeTimers();
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.createDocument).not.toHaveBeenCalled();
    expect(storage.saveDocument).not.toHaveBeenCalled();
    expect(strokesRef.current).toEqual([]);
    expect(actor.getSnapshot().context.fileUri).toBeNull();
    expect(actor.getSnapshot().value).toEqual({ editing: 'clean' });
    vi.useRealTimers();
  });

  it('saves a dirty note before resetting it', async () => {
    const { actor } = await startNote('saf://existing');
    vi.useFakeTimers();
    stroke(actor);
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.saveDocument).toHaveBeenCalledTimes(1);
    expect(canvas.clear).toHaveBeenCalled();
    expect(actor.getSnapshot().value).toEqual({ editing: 'clean' });
    vi.useRealTimers();
  });

  it('awaits intent pause and quiet settling, including a late stroke', async () => {
    const pause = deferred<void>();
    canvas.pauseDrawing.mockReturnValueOnce(pause.promise);
    const { actor } = await startNote('saf://existing');
    vi.useFakeTimers();
    stroke(actor);
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    expect(storage.saveDocument).not.toHaveBeenCalled();
    pause.resolve();
    await flush();
    vi.advanceTimersByTime(999);
    await flush();
    stroke(actor);
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.saveDocument).toHaveBeenCalledTimes(1);
    expect(storage.saveDocument.mock.calls[0][1]).toContain('strokes="3"');
  });

  it('saves a dirty new note once, then resets it', async () => {
    const { actor, strokesRef } = await startNote();
    vi.useFakeTimers();
    stroke(actor);
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.createDocument).toHaveBeenCalledTimes(1);
    expect(storage.saveDocument).toHaveBeenCalledTimes(1);
    expect(canvas.clear).toHaveBeenCalledTimes(1);
    expect(actor.getSnapshot().context.fileUri).toBeNull();
    expect(strokesRef.current).toEqual([]);
  });

  it('ignores repeated New while the dirty-new save is unresolved', async () => {
    const write = deferred<void>();
    storage.saveDocument.mockReturnValueOnce(write.promise);
    const { actor } = await startNote();
    vi.useFakeTimers();
    stroke(actor);
    actor.send({ type: 'NEW_NOTE' });
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.createDocument).toHaveBeenCalledTimes(1);
    expect(storage.saveDocument).toHaveBeenCalledTimes(1);
    expect(canvas.clear).not.toHaveBeenCalled();
    write.resolve();
    await flush();
    expect(storage.saveDocument).toHaveBeenCalledTimes(1);
    expect(canvas.clear).toHaveBeenCalledTimes(1);
  });

  it('retains the current note when reset fails', async () => {
    const { actor, strokesRef } = await startNote('saf://existing');
    const original = strokesRef.current;
    canvas.clear.mockRejectedValueOnce(new Error('native clear failed'));
    vi.useFakeTimers();
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: 'clean' });
    expect(actor.getSnapshot().context.fileUri).toBe('saf://existing');
    expect(strokesRef.current).toBe(original);
    expect(canvas.resumeDrawing).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not clear the current note after a New save failure', async () => {
    const { actor, strokesRef } = await startNote('saf://existing');
    const original = strokesRef.current;
    vi.useFakeTimers();
    storage.saveDocument.mockRejectedValueOnce(new Error('disk full'));
    stroke(actor);
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(canvas.clear).not.toHaveBeenCalled();
    expect(actor.getSnapshot().context.fileUri).toBe('saf://existing');
    expect(strokesRef.current).toBe(original);
  });

  it('clears failed dirty-new intent so a later edit does not reset', async () => {
    storage.saveDocument.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    const { actor } = await startNote();
    vi.useFakeTimers();
    stroke(actor);
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(actor.getSnapshot().context.pendingIntent).toBeNull();
    expect(canvas.clear).not.toHaveBeenCalled();
    stroke(actor);
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.createDocument).toHaveBeenCalledTimes(1);
    expect(storage.saveDocument).toHaveBeenCalledTimes(2);
    expect(canvas.clear).not.toHaveBeenCalled();
  });

  it('runs reset in pause, clear, resume order and preserves the folder', async () => {
    const calls: string[] = [];
    canvas.pauseDrawing.mockImplementationOnce(() => {
      calls.push('pause');
      return Promise.resolve();
    });
    canvas.clear.mockImplementationOnce(() => {
      calls.push('clear');
      return Promise.resolve();
    });
    canvas.resumeDrawing.mockImplementationOnce(() => {
      calls.push('resume');
      return Promise.resolve();
    });
    const { actor } = await startNote('saf://existing');
    vi.useFakeTimers();
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(calls).toEqual(['pause', 'clear', 'resume']);
    expect(actor.getSnapshot().context.folderUri).toBe('folder');
    expect(actor.getSnapshot().context.fileUri).toBeNull();
    vi.useRealTimers();
  });

  it('allocates the next document in the preserved folder after reset', async () => {
    const { actor } = await startNote('saf://existing');
    vi.useFakeTimers();
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    stroke(actor);
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.createDocument).toHaveBeenCalledWith('folder');
    vi.useRealTimers();
  });

  it('starts reset on the first foreground after a backgrounded New save', async () => {
    const write = deferred<void>();
    storage.saveDocument.mockReturnValueOnce(write.promise);
    const { actor } = await startNote('saf://existing');
    vi.useFakeTimers();
    stroke(actor);
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    actor.send({ type: 'APP_BACKGROUND' });
    write.resolve();
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: { backgrounded: 'surfaceAlive' } });
    actor.send({ type: 'APP_FOREGROUND' });
    await flush();
    expect(canvas.clear).toHaveBeenCalled();
    expect(actor.getSnapshot().value).toEqual({ editing: 'clean' });
  });

  it('increments revision once, and only for an actual erase', async () => {
    const { actor } = await startNote('saf://existing');
    stroke(actor);
    stroke(actor);
    await flush();
    expect(actor.getSnapshot().context.revision).toBe(2);

    actor.send({ type: 'ERASE_END', indices: [99] });
    await flush();
    expect(actor.getSnapshot().context.revision).toBe(2);

    actor.send({ type: 'ERASE_END', indices: [0] });
    await flush();
    expect(actor.getSnapshot().context.revision).toBe(3);
  });

  it('does not save or reset after a no-op erase', async () => {
    const { actor, strokesRef } = await startNote('saf://existing');
    const originalStrokes = strokesRef.current;
    vi.useFakeTimers();
    actor.send({ type: 'ERASE_END', indices: [99] });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();

    expect(storage.createDocument).not.toHaveBeenCalled();
    expect(storage.saveDocument).not.toHaveBeenCalled();
    expect(canvas.clear).not.toHaveBeenCalled();
    expect(actor.getSnapshot().context.fileUri).toBe('saf://existing');
    expect(strokesRef.current).toBe(originalStrokes);
    expect(actor.getSnapshot().value).toEqual({ editing: 'clean' });
    vi.useRealTimers();
  });

  it('clean existing CLOSE waits for pause and settle, capturing a late stroke', async () => {
    const pause = deferred<void>();
    canvas.pauseDrawing.mockReturnValueOnce(pause.promise);
    const navigate = vi.fn(() => Promise.resolve());
    const { actor } = await startNote('saf://existing', navigate);
    vi.useFakeTimers();
    actor.send({ type: 'CLOSE_NOTE' });
    await flush();
    pause.resolve();
    await flush();
    vi.advanceTimersByTime(999);
    actor.send({ type: 'STROKE_END', points: '0,0,1,1', color: '#000', width: 2 });
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.saveDocument).toHaveBeenCalled();
    expect(storage.saveDocument.mock.calls.at(-1)?.[1]).toContain('strokes="2"');
    expect(navigate).not.toHaveBeenCalled();
    expect(actor.getSnapshot().value).not.toBe('idle');
    vi.advanceTimersByTime(1000);
    await flush();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(actor.getSnapshot().value).toBe('idle');
    vi.useRealTimers();
  });

  it('defers background persistence until pause and quiet settling complete', async () => {
    const pause = deferred<void>();
    canvas.pauseDrawing.mockReturnValueOnce(pause.promise);
    const { actor } = await startNote();
    vi.useFakeTimers();
    stroke(actor);
    actor.send({ type: 'APP_BACKGROUND' });
    await flush();

    expect(actor.getSnapshot().value).toEqual({ saving: 'pausing' });
    expect(storage.createDocument).not.toHaveBeenCalled();
    expect(storage.saveDocument).not.toHaveBeenCalled();

    pause.resolve();
    await flush();
    vi.advanceTimersByTime(999);
    await flush();
    expect(storage.createDocument).not.toHaveBeenCalled();
    expect(storage.saveDocument).not.toHaveBeenCalled();

    stroke(actor);
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.createDocument).toHaveBeenCalledTimes(1);
    expect(storage.saveDocument).toHaveBeenCalledTimes(1);
    expect(storage.saveDocument.mock.calls[0][1]).toContain('strokes="2"');
    expect(actor.getSnapshot().value).toEqual({ editing: { backgrounded: 'surfaceAlive' } });
    vi.useRealTimers();
  });

  it('starts pause immediately during an unresolved autosave and awaits that pause once', async () => {
    const write = deferred<void>();
    const pause = deferred<void>();
    storage.saveDocument.mockReturnValueOnce(write.promise);
    canvas.pauseDrawing.mockReturnValueOnce(pause.promise);
    const { actor } = await startNote('saf://existing');
    vi.useFakeTimers();
    stroke(actor);
    vi.advanceTimersByTime(1000);
    await flush();

    actor.send({ type: 'APP_BACKGROUND' });
    await flush();
    expect(canvas.pauseDrawing).toHaveBeenCalledTimes(1);
    expect(actor.getSnapshot().value).toEqual({ saving: 'writing' });

    write.resolve();
    await flush();
    expect(actor.getSnapshot().value).toEqual({ saving: 'pausing' });
    expect(canvas.pauseDrawing).toHaveBeenCalledTimes(1);

    pause.resolve();
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: { backgrounded: 'surfaceAlive' } });
    expect(canvas.pauseDrawing).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('settles clean background before pausing, retaining a late stroke', async () => {
    const pause = deferred<void>();
    canvas.pauseDrawing.mockReturnValueOnce(pause.promise);
    const { actor } = await startNote('saf://existing');
    vi.useFakeTimers();
    actor.send({ type: 'APP_BACKGROUND' });
    await flush();
    expect(actor.getSnapshot().value).toEqual({ saving: 'pausing' });
    expect(canvas.pauseDrawing).toHaveBeenCalledTimes(1);

    pause.resolve();
    await flush();
    vi.advanceTimersByTime(999);
    stroke(actor);
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.saveDocument).toHaveBeenCalledTimes(1);
    expect(storage.saveDocument.mock.calls[0][1]).toContain('strokes="2"');
    expect(actor.getSnapshot().value).toEqual({ editing: { backgrounded: 'surfaceAlive' } });
    expect(canvas.pauseDrawing).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does not create a document for blank clean background', async () => {
    const { actor } = await startNote();
    vi.useFakeTimers();
    actor.send({ type: 'APP_BACKGROUND' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.createDocument).not.toHaveBeenCalled();
    expect(storage.saveDocument).not.toHaveBeenCalled();
    expect(actor.getSnapshot().value).toEqual({ editing: { backgrounded: 'surfaceAlive' } });
    vi.useRealTimers();
  });

  it('restores after foreground arrives during an unresolved autosave', async () => {
    const write = deferred<void>();
    storage.saveDocument.mockReturnValueOnce(write.promise);
    const { actor } = await startNote('saf://existing');
    vi.useFakeTimers();
    stroke(actor);
    vi.advanceTimersByTime(1000);
    await flush();
    actor.send({ type: 'APP_BACKGROUND' });
    actor.send({ type: 'APP_FOREGROUND' });
    write.resolve();
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: 'clean' });
    expect(actor.getSnapshot().context.foregroundRestoreNeeded).toBe(false);
    expect(actor.getSnapshot().context.surfaceRecreated).toBe(false);
    vi.useRealTimers();
  });

  it('uses fresh restoration after CANVAS_READY during save only once', async () => {
    const write = deferred<void>();
    storage.saveDocument.mockReturnValueOnce(write.promise).mockResolvedValue(undefined);
    const { actor } = await startNote('saf://existing');
    vi.useFakeTimers();
    stroke(actor);
    vi.advanceTimersByTime(1000);
    await flush();
    actor.send({ type: 'APP_BACKGROUND' });
    actor.send({ type: 'CANVAS_READY' });
    actor.send({ type: 'APP_FOREGROUND' });
    write.resolve();
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    const loads = canvas.loadStrokes.mock.calls.length;
    stroke(actor);
    vi.advanceTimersByTime(1000);
    await flush();
    expect(canvas.loadStrokes.mock.calls.length).toBe(loads);
    expect(actor.getSnapshot().context.surfaceRecreated).toBe(false);
    vi.useRealTimers();
  });

  it('retries reset after background and uses startDrawing for a recreated surface', async () => {
    const firstPause = deferred<void>();
    canvas.pauseDrawing.mockReturnValueOnce(firstPause.promise);
    const { actor } = await startNote('saf://existing');
    const startupStart = canvas.startDrawing.mock.calls.length;
    const startupLoad = canvas.loadStrokes.mock.calls.length;
    const startupResume = canvas.resumeDrawing.mock.calls.length;
    const restore = deferred<void>();
    canvas.startDrawing.mockReturnValueOnce(restore.promise);
    vi.useFakeTimers();
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    expect(actor.getSnapshot().value).toEqual({ saving: 'pausing' });
    actor.send({ type: 'APP_BACKGROUND' });
    actor.send({ type: 'CANVAS_READY' });
    actor.send({ type: 'APP_FOREGROUND' });
    firstPause.resolve();
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(actor.getSnapshot().value).toEqual({ reset: 'restoring' });
    restore.resolve();
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: 'clean' });
    expect(canvas.startDrawing.mock.calls.length).toBeGreaterThan(startupStart);
    expect(canvas.loadStrokes.mock.calls.length).toBe(startupLoad);
    expect(canvas.resumeDrawing.mock.calls.length).toBe(startupResume);
    vi.useRealTimers();
  });

  it('does not require a second foreground when reset restore is deferred', async () => {
    const restore = deferred<void>();
    canvas.resumeDrawing.mockReturnValueOnce(restore.promise);
    const { actor } = await startNote('saf://existing');
    vi.useFakeTimers();
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(actor.getSnapshot().value).toEqual({ reset: 'restoring' });

    actor.send({ type: 'APP_BACKGROUND' });
    actor.send({ type: 'APP_FOREGROUND' });
    restore.resolve();
    await flush();

    expect(actor.getSnapshot().value).toEqual({ editing: 'clean' });
    expect(actor.getSnapshot().context.currentBackgrounded).toBe(false);
    vi.useRealTimers();
  });

  it('pauses a deferred fresh restore that completes in the background', async () => {
    const restore = deferred<void>();
    const { actor } = await startNote('saf://existing');
    canvas.startDrawing.mockReturnValueOnce(restore.promise);
    vi.useFakeTimers();
    actor.send({ type: 'APP_BACKGROUND' });
    actor.send({ type: 'CANVAS_READY' });
    actor.send({ type: 'APP_FOREGROUND' });
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: 'resumingFresh' });

    actor.send({ type: 'APP_BACKGROUND' });
    restore.resolve();
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: { backgrounded: 'surfaceAlive' } });
    expect(actor.getSnapshot().context.surfaceRecreated).toBe(true);
    expect(canvas.pauseDrawing).toHaveBeenCalled();

    actor.send({ type: 'APP_FOREGROUND' });
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: 'clean' });
    vi.useRealTimers();
  });

  it('pauses a deferred paused restore that completes in the background', async () => {
    const restore = deferred<void>();
    canvas.resumeDrawing.mockReturnValueOnce(restore.promise);
    const { actor } = await startNote('saf://existing');
    vi.useFakeTimers();
    actor.send({ type: 'APP_BACKGROUND' });
    actor.send({ type: 'APP_FOREGROUND' });
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: 'resumingPaused' });

    actor.send({ type: 'APP_BACKGROUND' });
    restore.resolve();
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: { backgrounded: 'surfaceAlive' } });
    expect(canvas.pauseDrawing).toHaveBeenCalled();

    actor.send({ type: 'APP_FOREGROUND' });
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: 'clean' });
    vi.useRealTimers();
  });

  it('preserves fresh restoration after a save-selected restore is backgrounded', async () => {
    const write = deferred<void>();
    const restore = deferred<void>();
    storage.saveDocument.mockReturnValueOnce(write.promise);
    const { actor } = await startNote('saf://existing');
    const startupLoad = canvas.loadStrokes.mock.calls.length;
    const startupStart = canvas.startDrawing.mock.calls.length;
    const startupResume = canvas.resumeDrawing.mock.calls.length;
    canvas.startDrawing.mockReturnValueOnce(restore.promise);

    vi.useFakeTimers();
    stroke(actor);
    vi.advanceTimersByTime(1000);
    await flush();
    actor.send({ type: 'APP_BACKGROUND' });
    actor.send({ type: 'CANVAS_READY' });
    actor.send({ type: 'APP_FOREGROUND' });
    write.resolve();
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: 'resumingFresh' });

    actor.send({ type: 'APP_BACKGROUND' });
    restore.resolve();
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: { backgrounded: 'surfaceAlive' } });
    expect(actor.getSnapshot().context.surfaceRecreated).toBe(true);

    actor.send({ type: 'APP_FOREGROUND' });
    await flush();
    expect(canvas.loadStrokes.mock.calls.length).toBeGreaterThan(startupLoad);
    expect(canvas.startDrawing.mock.calls.length).toBeGreaterThan(startupStart);
    expect(canvas.resumeDrawing.mock.calls.length).toBe(startupResume);
    vi.useRealTimers();
  });

  it('retries a failed close save on the same URI and navigates after success', async () => {
    storage.saveDocument.mockRejectedValueOnce(new Error('disk')).mockResolvedValue(undefined);
    const navigate = vi.fn(() => Promise.resolve());
    const { actor } = await startNote('saf://existing', navigate);
    vi.useFakeTimers();
    stroke(actor);
    actor.send({ type: 'CLOSE_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    actor.send({ type: 'CLOSE_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.saveDocument.mock.calls.every(([uri]) => uri === 'saf://existing')).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('lets CLOSE override New during an active write without clearing', async () => {
    const write = deferred<void>();
    storage.saveDocument.mockReturnValueOnce(write.promise);
    const navigate = vi.fn(() => Promise.resolve());
    const { actor, strokesRef } = await startNote('saf://existing', navigate);
    vi.useFakeTimers();
    stroke(actor);
    vi.advanceTimersByTime(1000);
    await flush();
    actor.send({ type: 'NEW_NOTE' });
    actor.send({ type: 'CLOSE_NOTE' });
    write.resolve();
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(canvas.clear).not.toHaveBeenCalled();
    expect(strokesRef.current.length).toBeGreaterThan(0);
    expect(actor.getSnapshot().value).toBe('idle');
    vi.useRealTimers();
  });

  it('clears failed dirty-new intent when native reset fails', async () => {
    storage.saveDocument.mockResolvedValue(undefined);
    canvas.clear.mockRejectedValueOnce(new Error('clear'));
    const { actor } = await startNote();
    vi.useFakeTimers();
    stroke(actor);
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(actor.getSnapshot().context.pendingIntent).toBeNull();
    stroke(actor);
    vi.advanceTimersByTime(1000);
    await flush();
    expect(canvas.clear).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does not persist an empty new note after draw and erase before Close', async () => {
    const { actor } = await startNote();
    vi.useFakeTimers();
    stroke(actor);
    actor.send({ type: 'ERASE_END', indices: [0] });
    actor.send({ type: 'CLOSE_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.createDocument).not.toHaveBeenCalled();
    expect(storage.saveDocument).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not persist an empty new note after draw and erase before New', async () => {
    const { actor } = await startNote();
    vi.useFakeTimers();
    stroke(actor);
    actor.send({ type: 'ERASE_END', indices: [0] });
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.createDocument).not.toHaveBeenCalled();
    expect(storage.saveDocument).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('resumes when an intent write fails after its pause succeeds', async () => {
    storage.saveDocument.mockRejectedValueOnce(new Error('disk'));
    const { actor } = await startNote('saf://existing');
    vi.useFakeTimers();
    stroke(actor);
    actor.send({ type: 'CLOSE_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(canvas.resumeDrawing).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('restores fresh after a backgrounded save completes with CANVAS_READY', async () => {
    const write = deferred<void>();
    storage.saveDocument.mockReturnValueOnce(write.promise);
    const { actor } = await startNote('saf://existing');
    const startupStart = canvas.startDrawing.mock.calls.length;
    const startupLoad = canvas.loadStrokes.mock.calls.length;
    vi.useFakeTimers();
    stroke(actor);
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    actor.send({ type: 'APP_BACKGROUND' });
    actor.send({ type: 'CANVAS_READY' });
    write.resolve();
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: { backgrounded: 'surfaceAlive' } });
    actor.send({ type: 'APP_FOREGROUND' });
    await flush();
    expect(canvas.startDrawing.mock.calls.length).toBeGreaterThan(startupStart);
    expect(canvas.loadStrokes.mock.calls.length).toBeGreaterThan(startupLoad);
    expect(actor.getSnapshot().context.surfaceRecreated).toBe(false);
    vi.useRealTimers();
  });

  it('returns dirty after a background save failure and retries it in foreground', async () => {
    const failedWrite = deferred<void>();
    storage.saveDocument.mockReturnValueOnce(failedWrite.promise).mockResolvedValue(undefined);
    const { actor } = await startNote('saf://existing');
    vi.useFakeTimers();
    stroke(actor);
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    actor.send({ type: 'APP_BACKGROUND' });
    failedWrite.reject(new Error('disk'));
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: { backgrounded: 'surfaceAlive' } });
    actor.send({ type: 'APP_FOREGROUND' });
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: 'dirty' });
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.saveDocument).toHaveBeenCalledTimes(2);
    expect(storage.saveDocument.mock.calls[1][1]).toBe(storage.saveDocument.mock.calls[0][1]);
    vi.useRealTimers();
  });

  it('keeps reset restore failures in retry flow until CANVAS_READY succeeds', async () => {
    canvas.resumeDrawing.mockRejectedValueOnce(new Error('restore'));
    const { actor } = await startNote('saf://existing');
    vi.useFakeTimers();
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(actor.getSnapshot().value).toEqual({ reset: 'restoreFailed' });
    actor.send({ type: 'CANVAS_READY' });
    await flush();
    expect(actor.getSnapshot().value).toEqual({ editing: 'clean' });
    vi.useRealTimers();
  });

  it('allows CLOSE to escape a failed reset and navigate', async () => {
    const navigate = vi.fn(() => Promise.resolve());
    canvas.resumeDrawing.mockRejectedValueOnce(new Error('restore'));
    const { actor } = await startNote('saf://existing', navigate);
    vi.useFakeTimers();
    actor.send({ type: 'NEW_NOTE' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(actor.getSnapshot().value).toEqual({ reset: 'restoreFailed' });

    actor.send({ type: 'CLOSE_NOTE' });
    await flush();
    expect(actor.getSnapshot().value).toBe('idle');
    expect(navigate).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('saves a dirty intent that backgrounds during quiet settling before closing', async () => {
    const write = deferred<void>();
    storage.saveDocument.mockReturnValueOnce(write.promise);
    const navigate = vi.fn(() => Promise.resolve());
    const { actor } = await startNote('saf://existing', navigate);
    vi.useFakeTimers();
    stroke(actor);
    actor.send({ type: 'CLOSE_NOTE' });
    await flush();
    actor.send({ type: 'APP_BACKGROUND' });
    vi.advanceTimersByTime(1000);
    await flush();
    expect(storage.saveDocument).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    write.resolve();
    await flush();
    actor.send({ type: 'APP_FOREGROUND' });
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(actor.getSnapshot().value).toBe('idle');
    expect(canvas.clear).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
