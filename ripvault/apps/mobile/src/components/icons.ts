import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

/** Any Ionicons glyph name, e.g. "layers", "cube-outline". Browse: https://icons.expo.fyi (Ionicons). */
export type IconName = ComponentProps<typeof Ionicons>['name'];
