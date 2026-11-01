/**
 * Full-area states for screens and lists: LoadingState, EmptyState, ErrorState, plus Skeleton blocks.
 * Use them as a FlatList's ListEmptyComponent or as the whole body of a screen.
 */
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native';
import type { DimensionValue, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing } from '../theme.ts';
import { toApiError } from '../api/client.ts';
import { AppText } from './AppText.tsx';
import { Button } from './Button.tsx';
import type { ButtonVariant } from './Button.tsx';
import type { IconName } from './icons.ts';

// ---------------------------------------------------------------------------

export interface LoadingStateProps {
  /** Optional caption under the spinner. */
  label?: string;
  /** Fill the available space and centre (default true). False = compact block, e.g. list footer. */
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function LoadingState({ label, fill = true, style }: LoadingStateProps) {
  return (
    <View
      style={[fill ? styles.fill : styles.compact, style]}
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? 'Loading'}
    >
      <ActivityIndicator size="large" color={colors.gold} />
      {label ? (
        <AppText variant="caption" align="center" style={styles.loadingLabel}>
          {label}
        </AppText>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  title: string;
  message?: string;
  /** Ionicons name in the medallion (default "sparkles-outline"). */
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  /** Button style for the action (default "holo"). */
  actionVariant?: ButtonVariant;
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  title,
  message,
  icon = 'sparkles-outline',
  actionLabel,
  onAction,
  actionVariant = 'holo',
  fill = true,
  style,
}: EmptyStateProps) {
  return (
    <View style={[fill ? styles.fill : styles.compact, style]}>
      <Medallion icon={icon} color={colors.gold} />
      <AppText variant="heading" align="center" style={styles.title}>
        {title}
      </AppText>
      {message ? (
        <AppText variant="body" tone="muted" align="center" style={styles.message}>
          {message}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} variant={actionVariant} style={styles.action} />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface ErrorStateProps {
  /** The thrown error (ApiError or anything); its message is shown. */
  error?: unknown;
  /** Overrides the message derived from `error`. */
  message?: string;
  title?: string;
  onRetry?: () => void;
  /** Spinner on the retry button. */
  retrying?: boolean;
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ErrorState({ error, message, title, onRetry, retrying, fill = true, style }: ErrorStateProps) {
  const err = error !== undefined && error !== null ? toApiError(error) : null;
  const offline = err?.code === 'network' || err?.code === 'timeout';
  return (
    <View style={[fill ? styles.fill : styles.compact, style]} accessibilityLiveRegion="polite">
      <Medallion icon={offline ? 'cloud-offline-outline' : 'alert-circle-outline'} color={colors.danger} />
      <AppText variant="heading" align="center" style={styles.title}>
        {title ?? (offline ? "Can't connect" : 'Something went wrong')}
      </AppText>
      <AppText variant="body" tone="muted" align="center" style={styles.message}>
        {message ?? err?.message ?? 'Please try again.'}
      </AppText>
      {onRetry ? (
        <Button title="Try again" icon="refresh" onPress={onRetry} loading={retrying} variant="secondary" style={styles.action} />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------

function Medallion({ icon, color }: { icon: IconName; color: string }) {
  return (
    <View style={styles.medallion}>
      <LinearGradient
        colors={[colors.surfaceRaised, colors.surface]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, styles.medallionFill]}
      />
      <Ionicons name={icon} size={30} color={color} />
    </View>
  );
}

// ---------------------------------------------------------------------------

export interface SkeletonProps {
  width?: DimensionValue;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/** Pulsing placeholder block for content that is loading (cards, rows). */
export function Skeleton({ width = '100%', height, radius = radii.sm, style }: SkeletonProps) {
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.surfaceRaised, opacity: pulse }, style]}
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxxl,
  },
  compact: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
  },
  loadingLabel: { marginTop: spacing.md },
  medallion: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  medallionFill: { borderRadius: 36 },
  title: { marginBottom: spacing.xs },
  message: { maxWidth: 320 },
  action: { marginTop: spacing.xl, alignSelf: 'center' },
});
