/**
 * Small UI pieces shared by the account screens (wallet, profile, top-up, cash out, limits,
 * fairness, history, verify). Built on the foundation kit; theme tokens only.
 */
import { Fragment, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Animated, Platform, StyleSheet, View } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, gradients, HIT_SIZE, radii, spacing, withAlpha } from '../../theme.ts';
import { AppText, Button, IconButton, Panel, PressableScale, Skeleton } from '../../components/index.ts';
import type { IconName, TextTone } from '../../components/index.ts';
import type { ApiError } from '../../api/client.ts';
import { initialOf } from './format.ts';
import { useCopy } from './hooks.ts';

// ---------------------------------------------------------------------------
// Monospace text (seeds, hashes)
// ---------------------------------------------------------------------------

export const MONO_FONT: string | undefined = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export function MonoText({
  children,
  size = 13,
  tone = 'default',
  numberOfLines,
  style,
}: {
  children?: ReactNode;
  size?: number;
  tone?: TextTone;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <AppText variant="body" size={size} tone={tone} selectable numberOfLines={numberOfLines} style={[styles.mono, style]}>
      {children}
    </AppText>
  );
}

export interface CopyFieldProps {
  label: string;
  /** Shown (and copied unless copyValue is given). */
  value: string;
  copyValue?: string;
  /** Name used in the toast / accessibility label, e.g. "Server seed hash". Default: label. */
  what?: string;
  /** Highlight (e.g. a freshly revealed seed). */
  accent?: string;
  /** Hide the copy button (e.g. value is a placeholder). */
  copyable?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Label + monospace value + copy button. */
export function CopyField({ label, value, copyValue, what, accent, copyable = true, style }: CopyFieldProps) {
  const copy = useCopy();
  const name = what ?? label;
  return (
    <View style={[styles.copyField, style]}>
      <AppText variant="label" color={accent} style={styles.copyLabel}>
        {label}
      </AppText>
      <View style={[styles.copyBox, accent ? { borderColor: withAlpha(accent, 0.5) } : null]}>
        <MonoText style={styles.copyValue} tone={copyable ? 'default' : 'muted'}>
          {value}
        </MonoText>
        {copyable ? (
          <IconButton
            icon="copy-outline"
            variant="plain"
            size={18}
            color={accent ?? colors.textMuted}
            accessibilityLabel={`Copy ${name.toLowerCase()}`}
            onPress={() => copy(copyValue ?? value, name)}
          />
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

export function ProgressBar({
  value,
  color = colors.gold,
  height = 10,
  accessibilityLabel,
  style,
}: {
  /** 0..1 */
  value: number;
  color?: string;
  height?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Width is a layout prop, so this cannot use the native driver.
    Animated.timing(anim, { toValue: clamped, duration: 550, useNativeDriver: false }).start();
  }, [anim, clamped]);
  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View
      style={[styles.track, { height, borderRadius: height / 2 }, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <Animated.View style={[styles.fill, { width, borderRadius: height / 2, backgroundColor: color }]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Choice chips (amount presets, break lengths)
// ---------------------------------------------------------------------------

export interface ChoiceOption<T extends string | number> {
  value: T;
  label: string;
  caption?: string;
  icon?: IconName;
  disabled?: boolean;
}

export function ChoiceChips<T extends string | number>({
  options,
  value,
  onChange,
  columns = 4,
  accent = colors.gold,
  accessibilityLabel,
  style,
}: {
  options: readonly ChoiceOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  columns?: number;
  accent?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const basis = `${100 / columns}%` as const;
  return (
    <View style={[styles.chips, style]} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <View key={String(option.value)} style={[styles.chipCell, { width: basis }]}>
            <PressableScale
              onPress={() => onChange(option.value)}
              disabled={option.disabled}
              haptic="selection"
              scaleTo={0.95}
              accessibilityRole="radio"
              accessibilityLabel={option.caption ? `${option.label}, ${option.caption}` : option.label}
              accessibilityState={{ selected, checked: selected }}
              style={[
                styles.chip,
                selected ? { borderColor: accent, backgroundColor: withAlpha(accent, 0.14) } : null,
              ]}
            >
              {option.icon ? (
                <Ionicons name={option.icon} size={16} color={selected ? accent : colors.textMuted} style={styles.chipIcon} />
              ) : null}
              <AppText variant="money" size={16} color={selected ? accent : colors.text} numberOfLines={1} adjustsFontSizeToFit>
                {option.label}
              </AppText>
              {option.caption ? (
                <AppText variant="caption" size={11} tone="faint" numberOfLines={1}>
                  {option.caption}
                </AppText>
              ) : null}
            </PressableScale>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Grouped list (rows inside one rounded panel with hairline separators)
// ---------------------------------------------------------------------------

/** Flatten nested child arrays and drop null/false/'' so separators only go between real rows. */
function rowsOf(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  const visit = (node: ReactNode) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node !== null && node !== undefined && node !== false && node !== true && node !== '') out.push(node);
  };
  visit(children);
  return out;
}

export function ListGroup({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const rows = rowsOf(children);
  return (
    <Panel padded={false} style={[styles.group, style]}>
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i > 0 ? <View style={styles.separator} /> : null}
          {row}
        </Fragment>
      ))}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Notes and banners
// ---------------------------------------------------------------------------

/** Icon + short text in a softly tinted box (safer-play line, explanations, warnings). */
export function Note({
  icon,
  color = colors.violet,
  children,
  action,
  style,
}: {
  icon: IconName;
  color?: string;
  children?: ReactNode;
  /** Optional element on the right (e.g. a small ghost button). */
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.note, { backgroundColor: withAlpha(color, 0.1), borderColor: withAlpha(color, 0.3) }, style]}>
      <Ionicons name={icon} size={18} color={color} style={styles.noteIcon} />
      <View style={styles.noteBody}>{children}</View>
      {action ? <View style={styles.noteAction}>{action}</View> : null}
    </View>
  );
}

/** Shown above a list whose latest refresh failed while older data is still on screen. */
export function StaleBanner({ error, onRetry, style }: { error: ApiError; onRetry: () => void; style?: StyleProp<ViewStyle> }) {
  const offline = error.code === 'network' || error.code === 'timeout';
  return (
    <Note
      icon={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
      color={colors.danger}
      style={style}
      action={<Button title="Retry" variant="ghost" size="sm" onPress={onRetry} />}
    >
      <AppText variant="caption" tone="muted">
        {offline ? "You're offline. Showing what we had." : "Couldn't update. Showing what we had."}
      </AppText>
    </Note>
  );
}

/** Footer for infinite lists: spinner while loading more, retry after a failure, end marker. */
export function PageFooter({
  loadingMore,
  error,
  hasMore,
  count,
  onRetry,
  endLabel = "That's everything",
}: {
  loadingMore: boolean;
  error: ApiError | null;
  hasMore: boolean;
  count: number;
  onRetry: () => void;
  endLabel?: string;
}) {
  if (loadingMore) {
    return (
      <View style={styles.footer} accessibilityRole="progressbar" accessibilityLabel="Loading more">
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.footer}>
        <AppText variant="caption" tone="muted" align="center">
          {error.message}
        </AppText>
        <Button title="Load more" icon="refresh" variant="secondary" size="sm" onPress={onRetry} style={styles.footerButton} />
      </View>
    );
  }
  if (!hasMore && count > 8) {
    return (
      <View style={styles.footer}>
        <AppText variant="caption" tone="faint" align="center">
          {endLabel}
        </AppText>
      </View>
    );
  }
  return <View style={styles.footerSpacer} />;
}

/** Placeholder rows while a list loads for the first time. */
export function RowSkeletons({ count = 5, height = 64 }: { count?: number; height?: number }) {
  return (
    <View style={styles.skeletons} accessibilityRole="progressbar" accessibilityLabel="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} radius={radii.md} style={i > 0 ? styles.skeletonGap : null} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Avatar and stat tiles
// ---------------------------------------------------------------------------

export function Avatar({ name, size = 72 }: { name: string; size?: number }) {
  const ring = 3;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <LinearGradient
        colors={gradients.holo}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
      />
      <View
        style={[
          styles.avatarInner,
          { top: ring, left: ring, right: ring, bottom: ring, borderRadius: (size - ring * 2) / 2 },
        ]}
      >
        <AppText variant="title" size={Math.round(size * 0.42)} weight="900" color={colors.gold}>
          {initialOf(name)}
        </AppText>
      </View>
    </View>
  );
}

export function StatTile({
  label,
  icon,
  color = colors.violet,
  children,
  style,
}: {
  label: string;
  icon: IconName;
  color?: string;
  /** The value (MoneyText or AppText). */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Panel style={[styles.stat, style]}>
      <View style={styles.statHead}>
        <View style={[styles.statIcon, { backgroundColor: withAlpha(color, 0.16) }]}>
          <Ionicons name={icon} size={15} color={color} />
        </View>
        <AppText variant="label" numberOfLines={1} style={styles.statLabel}>
          {label}
        </AppText>
      </View>
      {children}
    </Panel>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: MONO_FONT, letterSpacing: 0, lineHeight: 19 },
  copyField: { alignSelf: 'stretch' },
  copyLabel: { marginBottom: spacing.xs + 2 },
  copyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: HIT_SIZE + 4,
    paddingLeft: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgAlt,
  },
  copyValue: { flex: 1, paddingVertical: spacing.sm },

  track: { width: '100%', overflow: 'hidden', backgroundColor: colors.surfaceRaised },
  fill: { height: '100%' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  chipCell: { padding: spacing.xs },
  chip: {
    minHeight: 56,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  chipIcon: { marginBottom: 2 },

  group: { overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: spacing.lg },

  note: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  noteIcon: { marginRight: spacing.md, alignSelf: 'flex-start', marginTop: 1 },
  noteBody: { flex: 1, minWidth: 0 },
  noteAction: { marginLeft: spacing.sm },

  footer: { alignItems: 'center', paddingVertical: spacing.xl },
  footerButton: { marginTop: spacing.md, alignSelf: 'center' },
  footerSpacer: { height: spacing.lg },

  skeletons: { paddingTop: spacing.xs },
  skeletonGap: { marginTop: spacing.sm },

  avatarInner: {
    position: 'absolute',
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },

  stat: { padding: spacing.lg },
  statHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  statIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  statLabel: { flex: 1 },
});
