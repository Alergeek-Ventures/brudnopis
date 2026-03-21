import AsyncStorage from '@react-native-async-storage/async-storage';
import { atomWithStorage, createJSONStorage } from 'jotai/utils';

import type { StrokeStyle } from '@/features/svg/types';

type PenSettings = {
  color: string;
  width: number;
};

type Tool = StrokeStyle | 'eraser';

/**
 * Persisted toolbar state — remembers the last-used pen, stroke width, and
 * color across canvas sessions. Uses the same `atomWithStorage` pattern as
 * other persisted settings (e.g. `activeLanguageAtom`).
 */
export type PersistedToolbarState = {
  activeTool: Tool;
  lastPenStyle: StrokeStyle;
  penSettings: Record<StrokeStyle, PenSettings>;
};

export const DEFAULT_PEN_SETTINGS: PersistedToolbarState = {
  activeTool: 'pencil',
  lastPenStyle: 'pencil',
  penSettings: {
    pencil: { color: '#000000', width: 5 },
    fountain: { color: '#000000', width: 5 },
    marker: { color: '#FFFF00', width: 40 },
  },
};

const storage = createJSONStorage<PersistedToolbarState>(() => AsyncStorage);

export const penSettingsAtom = atomWithStorage(
  'canvas_pen_settings',
  DEFAULT_PEN_SETTINGS,
  storage,
);
