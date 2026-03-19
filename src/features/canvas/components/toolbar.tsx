import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { useCallback, useRef, useState } from 'react';
import { type LayoutChangeEvent, PanResponder, Pressable, View } from 'react-native';

import type { StrokeStyle } from '@/features/svg/types';

/** Helper type for MaterialIcons name prop. */
type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

// ── Types ──────────────────────────────────────────────────────

type Tool = StrokeStyle | 'eraser';

type PenSettings = {
  color: string;
  width: number;
};

export type ToolbarState = {
  tool: Tool;
  /** Active stroke style (excluding eraser — eraser keeps last pen style for resume). */
  strokeStyle: StrokeStyle;
  strokeColor: string;
  strokeWidth: number;
};

type ToolbarProps = {
  onClose: () => void;
  onChange: (state: ToolbarState) => void;
  onExpandedChange: (expanded: boolean) => void;
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

/** Default per-pen settings (color + width). */
const DEFAULT_PEN_SETTINGS: Record<StrokeStyle, PenSettings> = {
  pencil: { color: '#000000', width: 5 },
  fountain: { color: '#000000', width: 5 },
  marker: { color: '#FFFF00', width: 40 },
};

const TOOLS: { tool: Tool; icon: IconName; label: string }[] = [
  { tool: 'pencil', icon: 'edit', label: 'Ballpoint' },
  { tool: 'fountain', icon: 'create', label: 'Fountain' },
  { tool: 'marker', icon: 'highlight', label: 'Marker' },
  { tool: 'eraser', icon: 'auto-fix-normal', label: 'Eraser' },
];

/** Icon to show for each pen style in the collapsed pill. */
const TOOL_ICONS: Record<Tool, IconName> = {
  pencil: 'edit',
  fountain: 'create',
  marker: 'highlight',
  eraser: 'auto-fix-normal',
};

// ── Helpers ────────────────────────────────────────────────────

function getWidthPresets(style: StrokeStyle) {
  return style === 'marker' ? MARKER_WIDTHS : PEN_WIDTHS;
}

function getToolbarState(
  tool: Tool,
  lastPenStyle: StrokeStyle,
  penSettings: Record<StrokeStyle, PenSettings>,
): ToolbarState {
  if (tool === 'eraser') {
    const settings = penSettings[lastPenStyle];
    return {
      tool: 'eraser',
      strokeStyle: lastPenStyle,
      strokeColor: settings.color,
      strokeWidth: settings.width,
    };
  }
  const settings = penSettings[tool];
  return {
    tool,
    strokeStyle: tool,
    strokeColor: settings.color,
    strokeWidth: settings.width,
  };
}

// ── Component ──────────────────────────────────────────────────

export function Toolbar({ onClose, onChange, onExpandedChange, onLayout }: ToolbarProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>('pencil');
  const [lastPenStyle, setLastPenStyle] = useState<StrokeStyle>('pencil');
  const [penSettings, setPenSettings] = useState<Record<StrokeStyle, PenSettings>>({
    ...DEFAULT_PEN_SETTINGS,
  });

  // ── Dragging (collapsed only) ──────────────────────────────
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const positionRef = useRef({ x: 0, y: 0 });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gestureState) => {
        // Only start drag if moved > 10px (avoids hijacking taps)
        return Math.abs(gestureState.dx) > 10 || Math.abs(gestureState.dy) > 10;
      },
      onPanResponderGrant: () => {
        positionRef.current = { ...position };
      },
      onPanResponderMove: (_evt, gestureState) => {
        setPosition({
          x: positionRef.current.x + gestureState.dx,
          y: positionRef.current.y + gestureState.dy,
        });
      },
      onPanResponderRelease: (_evt, gestureState) => {
        const newPos = {
          x: positionRef.current.x + gestureState.dx,
          y: positionRef.current.y + gestureState.dy,
        };
        setPosition(newPos);
        positionRef.current = newPos;
      },
    }),
  ).current;

  // ── Expand / collapse ──────────────────────────────────────

  const handleToggleExpand = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      if (next) {
        // Expanding: snap back to original position
        setPosition({ x: 0, y: 0 });
        positionRef.current = { x: 0, y: 0 };
      }
      onExpandedChange(next);
      return next;
    });
  }, [onExpandedChange]);

  // ── Tool selection ─────────────────────────────────────────

  const emitChange = useCallback(
    (tool: Tool, style: StrokeStyle, settings: Record<StrokeStyle, PenSettings>) => {
      onChange(getToolbarState(tool, style, settings));
    },
    [onChange],
  );

  const handleToolSelect = (tool: Tool) => {
    setActiveTool(tool);
    if (tool !== 'eraser') {
      setLastPenStyle(tool);
    }
    emitChange(tool, tool !== 'eraser' ? tool : lastPenStyle, penSettings);
  };

  const handleColorSelect = (color: string) => {
    const style = activeTool === 'eraser' ? lastPenStyle : activeTool;
    const updated = {
      ...penSettings,
      [style]: { ...penSettings[style], color },
    };
    setPenSettings(updated);
    emitChange(activeTool, style, updated);
  };

  const handleWidthSelect = (width: number) => {
    const style = activeTool === 'eraser' ? lastPenStyle : activeTool;
    const updated = {
      ...penSettings,
      [style]: { ...penSettings[style], width },
    };
    setPenSettings(updated);
    emitChange(activeTool, style, updated);
  };

  // ── Derived values ─────────────────────────────────────────

  const currentStyle = activeTool === 'eraser' ? lastPenStyle : activeTool;
  const currentSettings = penSettings[currentStyle];
  const widthPresets = getWidthPresets(currentStyle);

  // ── Render: Expanded ───────────────────────────────────────

  if (expanded) {
    return (
      <View className="absolute right-0 top-0 z-20 pt-safe pr-safe" onLayout={onLayout}>
        <View className="rounded-lg border border-gray-300 bg-white">
          {/* Row 1: Tool buttons + collapse toggle */}
          <View className="flex-row items-center border-b border-gray-300 px-2 py-1.5">
            <View className="flex-1 flex-row items-center gap-1">
              {TOOLS.map(({ tool, icon }) => (
                <Pressable
                  key={tool}
                  onPress={() => handleToolSelect(tool)}
                  className={`rounded-md p-2.5 ${
                    activeTool === tool ? 'bg-black' : 'bg-gray-200 active:bg-gray-300'
                  }`}
                >
                  <MaterialIcons
                    name={icon}
                    size={18}
                    color={activeTool === tool ? 'white' : 'black'}
                  />
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={handleToggleExpand}
              className="ml-2 rounded-md p-2.5 active:bg-gray-200"
            >
              <MaterialIcons name="chevron-right" size={18} color="black" />
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
    );
  }

  // ── Render: Collapsed (draggable pill) ─────────────────────

  return (
    <View
      className="absolute right-0 top-0 z-20 pt-safe pr-safe"
      style={{ transform: [{ translateX: position.x }, { translateY: position.y }] }}
      onLayout={onLayout}
      {...panResponder.panHandlers}
    >
      <View className="flex-row items-center rounded-lg border border-gray-300 bg-white">
        <Pressable
          onPress={onClose}
          className="rounded-l-lg border-r border-gray-300 p-3 active:bg-gray-200"
        >
          <MaterialIcons name="close" size={20} color="black" />
        </Pressable>
        <Pressable onPress={handleToggleExpand} className="rounded-r-lg p-3 active:bg-gray-200">
          <MaterialIcons
            name={TOOL_ICONS[activeTool]}
            size={20}
            color={activeTool === 'eraser' ? '#888' : currentSettings.color}
          />
        </Pressable>
      </View>
    </View>
  );
}
