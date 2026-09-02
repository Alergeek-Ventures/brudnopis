import { useAtom } from 'jotai';
import type { IconProps } from 'phosphor-react-native';
import { CaretRight, Eraser, FilePlus, Highlighter, Pen, PenNib, X } from 'phosphor-react-native';
import type { ComponentType } from 'react';
import { type LayoutChangeEvent, Pressable, View } from 'react-native';

import { DEFAULT_PEN_SETTINGS, penSettingsAtom } from '@/features/canvas/atoms/pen-settings';
import type { StrokeStyle } from '@/features/svg/types';

/** Phosphor icon component type — all toolbar icons share this shape. */
type IconComponent = ComponentType<IconProps>;

// ── Types ──────────────────────────────────────────────────────

type Tool = StrokeStyle | 'eraser';

type ToolbarProps = {
  /** Whether the toolbar is currently expanded (controlled by parent). */
  expanded: boolean;
  onClose: () => void;
  onNewNote: () => void;
  newNoteDisabled: boolean;
  /** Toggle between collapsed and expanded. */
  onToggleExpand: () => void;
  /** Reports the toolbar's on-screen bounds for SDK exclude-rect calculation. */
  onLayout: (event: LayoutChangeEvent) => void;
};

// ── Constants ──────────────────────────────────────────────────

/** Color palette — following Notable's color mode for color e-ink screens. */
const COLORS = [
  '#000000', // Black
  '#444444', // Dark Gray
  '#888888', // Gray
  '#FF0000', // Red
  '#00FF00', // Green
  '#0000FF', // Blue
  '#00FFFF', // Cyan
  '#FF00FF', // Magenta
  '#FFFF00', // Yellow
] as const;

/** Width presets for pens. */
const PEN_WIDTHS = [
  { label: 'S', value: 3 },
  { label: 'M', value: 5 },
  { label: 'L', value: 10 },
  { label: 'XL', value: 20 },
] as const;

/** Width presets for marker/highlighter. */
const MARKER_WIDTHS = [
  { label: 'M', value: 25 },
  { label: 'L', value: 40 },
  { label: 'XL', value: 60 },
  { label: 'XXL', value: 80 },
] as const;

const TOOLS: { tool: Tool; Icon: IconComponent; label: string }[] = [
  { tool: 'pencil', Icon: Pen, label: 'Ballpoint' },
  { tool: 'fountain', Icon: PenNib, label: 'Fountain' },
  { tool: 'marker', Icon: Highlighter, label: 'Marker' },
  { tool: 'eraser', Icon: Eraser, label: 'Eraser' },
];

/** Icon component for each tool — derived from TOOLS to avoid duplicate mapping. */
const TOOL_ICONS: Record<Tool, IconComponent> = Object.fromEntries(
  TOOLS.map(({ tool, Icon }) => [tool, Icon]),
) as Record<Tool, IconComponent>;

// ── Helpers ────────────────────────────────────────────────────

function getWidthPresets(style: StrokeStyle) {
  return style === 'marker' ? MARKER_WIDTHS : PEN_WIDTHS;
}

// ── Component ──────────────────────────────────────────────────

/**
 * Canvas toolbar — tool selection, color picker, width picker.
 *
 * FABRIC WORKAROUND: React Native's Fabric renderer on Android never updates
 * a native view's bounds after first mount when the view grows. The toolbar
 * always renders the full expanded layout so Fabric allocates maximum bounds
 * on first mount. When "collapsed", the collapsed pill is absolutely
 * positioned at top-right inside the same fixed-size container, and the
 * expanded rows become invisible (opacity 0, pointerEvents none). The native
 * view bounds never change.
 */
export function Toolbar({
  expanded,
  onClose,
  onNewNote,
  newNoteDisabled,
  onToggleExpand,
  onLayout,
}: ToolbarProps) {
  const [persisted, setPersisted] = useAtom(penSettingsAtom);
  const {
    activeTool = DEFAULT_PEN_SETTINGS.activeTool,
    lastPenStyle = DEFAULT_PEN_SETTINGS.lastPenStyle,
    penSettings = DEFAULT_PEN_SETTINGS.penSettings,
  } = persisted ?? DEFAULT_PEN_SETTINGS;

  // ── Tool selection ─────────────────────────────────────────

  const handleToolSelect = (tool: Tool) => {
    setPersisted({
      activeTool: tool,
      lastPenStyle: tool !== 'eraser' ? tool : lastPenStyle,
      penSettings,
    });
  };

  const handleColorSelect = (color: string) => {
    const style = activeTool === 'eraser' ? lastPenStyle : activeTool;
    setPersisted({
      activeTool,
      lastPenStyle,
      penSettings: { ...penSettings, [style]: { ...penSettings[style], color } },
    });
  };

  const handleWidthSelect = (width: number) => {
    const style = activeTool === 'eraser' ? lastPenStyle : activeTool;
    setPersisted({
      activeTool,
      lastPenStyle,
      penSettings: { ...penSettings, [style]: { ...penSettings[style], width } },
    });
  };

  // ── Derived values ─────────────────────────────────────────

  const currentStyle = activeTool === 'eraser' ? lastPenStyle : activeTool;
  const currentSettings = penSettings[currentStyle];
  const widthPresets = getWidthPresets(currentStyle);
  const ActiveIcon = TOOL_ICONS[activeTool];

  // ── Render ─────────────────────────────────────────────────
  // The expanded layout is ALWAYS rendered to keep native bounds constant.
  // When collapsed, the expanded content becomes invisible and a pill overlay
  // appears at the top-right.

  return (
    <View className="absolute right-0 top-0 z-20 mr-2 mt-2 pt-safe pr-safe" onLayout={onLayout}>
      {/* Expanded content — always in tree for constant native bounds.
          Invisible + non-interactive when collapsed. */}
      <View
        style={expanded ? undefined : { opacity: 0 }}
        pointerEvents={expanded ? 'auto' : 'none'}
      >
        <View className="rounded-lg border border-gray-300 bg-white">
          {/* Row 1: Tool buttons + collapse toggle */}
          <View className="flex-row items-center border-b border-gray-300 px-2 py-1.5">
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close note"
              className="rounded-md p-2.5 active:bg-gray-200"
            >
              <X size={18} color="black" />
            </Pressable>
            <Pressable
              onPress={onNewNote}
              disabled={newNoteDisabled}
              accessibilityRole="button"
              accessibilityLabel="New note"
              accessibilityState={{ disabled: newNoteDisabled }}
              className="rounded-md p-2.5 active:bg-gray-200 disabled:opacity-40"
            >
              <FilePlus size={18} color="black" />
            </Pressable>
            <View className="flex-1 flex-row items-center gap-1">
              {TOOLS.map(({ tool, Icon }) => (
                <Pressable
                  key={tool}
                  onPress={() => handleToolSelect(tool)}
                  className={`rounded-md p-2.5 ${
                    activeTool === tool ? 'bg-black' : 'bg-gray-200 active:bg-gray-300'
                  }`}
                >
                  <Icon size={18} color={activeTool === tool ? 'white' : 'black'} />
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={onToggleExpand}
              className="ml-2 rounded-md p-2.5 active:bg-gray-200"
            >
              <CaretRight size={18} color="black" />
            </Pressable>
          </View>

          {/* Row 2: Color swatches */}
          <View className="flex-row flex-wrap items-center gap-1 border-b border-gray-300 px-2 py-1.5">
            {COLORS.map((color) => (
              <Pressable
                key={color}
                onPress={() => handleColorSelect(color)}
                className="rounded-full p-0.5"
                style={
                  currentSettings.color === color
                    ? { borderWidth: 2, borderColor: '#000' }
                    : undefined
                }
              >
                <View
                  className="h-6 w-6 rounded-full"
                  style={{
                    backgroundColor: color,
                    borderWidth: color === '#000000' ? 0 : 1,
                    borderColor: '#ccc',
                  }}
                />
              </Pressable>
            ))}
          </View>

          {/* Row 3: Width presets */}
          <View className="flex-row items-center gap-1 px-2 py-1.5">
            {widthPresets.map((preset) => (
              <Pressable
                key={preset.label}
                onPress={() => handleWidthSelect(preset.value)}
                className={`items-center justify-center rounded-md px-2.5 py-1.5 ${
                  currentSettings.width === preset.value
                    ? 'bg-black'
                    : 'bg-gray-200 active:bg-gray-300'
                }`}
              >
                <View
                  className="rounded-full"
                  style={{
                    width: Math.min(preset.value, 16),
                    height: Math.min(preset.value, 16),
                    backgroundColor: currentSettings.width === preset.value ? '#fff' : '#000',
                  }}
                />
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      {/* Collapsed pill — absolutely positioned over the invisible expanded
          layout. Only visible when collapsed. */}
      {!expanded ? (
        <View className="absolute right-0 top-0 mr-2 mt-2 pr-safe pt-safe">
          <View className="flex-row items-center rounded-lg border border-gray-300 bg-white">
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close note"
              className="rounded-l-lg border-r border-gray-300 p-3 active:bg-gray-200"
            >
              <X size={20} color="black" />
            </Pressable>
            <Pressable
              onPress={onNewNote}
              disabled={newNoteDisabled}
              accessibilityRole="button"
              accessibilityLabel="New note"
              accessibilityState={{ disabled: newNoteDisabled }}
              className="border-r border-gray-300 p-3 active:bg-gray-200 disabled:opacity-40"
            >
              <FilePlus size={20} color="black" />
            </Pressable>
            <Pressable
              onPress={onToggleExpand}
              accessibilityRole="button"
              accessibilityLabel="Expand toolbar"
              className="rounded-r-lg p-3 active:bg-gray-200"
            >
              <ActiveIcon
                size={20}
                color={activeTool === 'eraser' ? '#888' : currentSettings.color}
              />
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
