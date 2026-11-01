/**
 * Haptic feedback helpers. Fire-and-forget; failures (web, unsupported devices) are ignored.
 *   haptic.tap()       light tap: button presses
 *   haptic.selection() tab/segment changes, toggles
 *   haptic.heavy()     pack rip / card flip
 *   haptic.success()   purchase done, sold, saved
 *   haptic.warning()   big confirmation prompts
 *   haptic.error()     failed action
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

function run(fn: () => Promise<void>): void {
  if (!enabled) return;
  fn().catch(() => undefined);
}

export const haptic = {
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  heavy: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  selection: () => run(() => Haptics.selectionAsync()),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};

export type HapticKind = keyof typeof haptic;
