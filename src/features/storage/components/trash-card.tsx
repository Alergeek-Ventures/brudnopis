import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { Pressable, Text, View } from 'react-native';

import { NoteThumbnail } from '@/features/notes/components/note-thumbnail';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/types/canvas';

import type { TrashedDocument } from '../types/trashed-document';
import { TRASH_TTL_MS } from '../utilities/trash';

const THUMBNAIL_ASPECT_RATIO = CANVAS_WIDTH / CANVAS_HEIGHT;

function formatDaysRemaining(deletedAt: number): string {
  const elapsed = Date.now() - deletedAt;
  const remaining = Math.max(0, Math.ceil((TRASH_TTL_MS - elapsed) / (24 * 60 * 60 * 1000)));
  if (remaining === 0) return 'Expiring soon';
  if (remaining === 1) return '1 day remaining';
  return `${remaining} days remaining`;
}

function formatDeletedDate(deletedAt: number): string {
  const date = new Date(deletedAt);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function TrashCard({
  item,
  selected,
  onPress,
}: {
  item: TrashedDocument;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="flex-1">
      <View
        className={`overflow-hidden rounded-lg border ${
          selected ? 'border-sky-700 bg-sky-50' : 'border-gray-300 bg-white'
        }`}
      >
        <View style={{ aspectRatio: THUMBNAIL_ASPECT_RATIO }}>
          {item.svgContent ? (
            <NoteThumbnail svgContent={item.svgContent} />
          ) : (
            <View className="flex-1 items-center justify-center bg-gray-100">
              <Text className="text-sm text-gray-600">Empty</Text>
            </View>
          )}
          {/* Selection checkbox overlay */}
          <View className="absolute left-1.5 top-1.5">
            <View
              className={`h-6 w-6 items-center justify-center rounded-full border-2 ${
                selected ? 'border-sky-700 bg-sky-700' : 'border-gray-400 bg-white'
              }`}
            >
              {selected ? <MaterialIcons name="check" size={14} color="white" /> : null}
            </View>
          </View>
        </View>
      </View>
      <View className="px-0.5 pt-1 pb-0.5">
        <Text className="text-xs text-gray-600" numberOfLines={1}>
          {formatDeletedDate(item.deletedAt)} · {formatDaysRemaining(item.deletedAt)}
        </Text>
      </View>
    </Pressable>
  );
}
