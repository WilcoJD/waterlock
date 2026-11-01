import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, HIT_SIZE, radii, shadows, spacing } from '../../theme.ts';
import { AppText } from '../../components/index.ts';
import type { IconName } from '../../components/index.ts';
import { haptic } from '../../lib/haptics.ts';

export interface SheetOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export interface OptionSheetProps<T extends string> {
  visible: boolean;
  title: string;
  options: readonly SheetOption<T>[];
  value: T;
  onSelect: (value: T) => void;
  onClose: () => void;
}

/** Bottom sheet with a single-choice list (used for the vault sort order). */
export function OptionSheet<T extends string>({ visible, title, options, value, onSelect, onClose }: OptionSheetProps<T>) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      slide.setValue(0);
      Animated.spring(slide, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 4 }).start();
    }
  }, [visible, slide]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + spacing.lg },
            { transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) }] },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles.handle} />
          <AppText variant="label" accessibilityRole="header" style={styles.title}>
            {title}
          </AppText>
          <View accessibilityRole="radiogroup">
            {options.map((option) => {
              const active = option.value === value;
              const fg = active ? colors.gold : colors.text;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    haptic.selection();
                    onSelect(option.value);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={option.label}
                  style={({ pressed }: PressableStateCallbackType) => [
                    styles.option,
                    active ? styles.optionActive : null,
                    pressed ? styles.optionPressed : null,
                  ]}
                >
                  {option.icon ? <Ionicons name={option.icon} size={18} color={fg} style={styles.optionIcon} /> : null}
                  <AppText variant="body" weight={active ? '700' : '500'} color={fg} style={styles.optionLabel}>
                    {option.label}
                  </AppText>
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={active ? colors.gold : colors.textFaint}
                  />
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.sm,
    ...shadows.floating,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.lg,
  },
  title: { marginBottom: spacing.sm },
  option: {
    minHeight: HIT_SIZE + 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.xs,
  },
  optionActive: { backgroundColor: colors.goldSoft },
  optionPressed: { backgroundColor: colors.surfacePressed },
  optionIcon: { marginRight: spacing.md },
  optionLabel: { flex: 1 },
});
