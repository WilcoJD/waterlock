/**
 * Toasts: brief messages at the top of the screen.
 *
 *   const toast = useToast();
 *   toast.success('Sold for £12.60');
 *   toast.error(err);                 // ApiError / Error / string
 *   toast.info('Copied to clipboard');
 *   toast.show({ type: 'info', title: 'Heads up', message: '...', durationMs: 6000 });
 *
 * One toast at a time (a new one replaces the current). Tap to dismiss. Success/error fire a haptic.
 * On iOS it renders in a FullWindowOverlay so it also shows above native modals (topup, pack sheet).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, shadows, spacing, withAlpha } from '../theme.ts';
import { errorMessage } from '../api/client.ts';
import { haptic } from '../lib/haptics.ts';
import { AppText } from './AppText.tsx';
import type { IconName } from './icons.ts';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastOptions {
  message: string;
  title?: string;
  type?: ToastType;
  /** Auto-dismiss delay (default 3.5s, errors 5s). */
  durationMs?: number;
}

export interface ToastApi {
  show: (options: ToastOptions) => void;
  success: (message: string, title?: string) => void;
  /** Accepts an ApiError/Error (uses its message) or a string. */
  error: (errorOrMessage: unknown, title?: string) => void;
  info: (message: string, title?: string) => void;
  hide: () => void;
}

interface ActiveToast extends Required<Pick<ToastOptions, 'message' | 'type' | 'durationMs'>> {
  id: number;
  title?: string;
}

const ToastContext = createContext<ToastApi | null>(null);

const TYPE_STYLE: Record<ToastType, { icon: IconName; color: string }> = {
  success: { icon: 'checkmark-circle', color: colors.success },
  error: { icon: 'alert-circle', color: colors.danger },
  info: { icon: 'information-circle', color: colors.violet },
};

export function ToastProvider({ children }: { children?: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const nextId = useRef(1);

  const hide = useCallback(() => setToast(null), []);
  /** Hide only if `id` is still the visible toast (a late close of a replaced toast is ignored). */
  const dismiss = useCallback((id: number) => setToast((current) => (current && current.id === id ? null : current)), []);

  const show = useCallback((options: ToastOptions) => {
    const type = options.type ?? 'info';
    if (type === 'success') haptic.success();
    else if (type === 'error') haptic.error();
    setToast({
      id: nextId.current++,
      message: options.message,
      title: options.title,
      type,
      durationMs: options.durationMs ?? (type === 'error' ? 5_000 : 3_500),
    });
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      hide,
      success: (message, title) => show({ type: 'success', message, title }),
      info: (message, title) => show({ type: 'info', message, title }),
      error: (errorOrMessage, title) =>
        show({
          type: 'error',
          message: typeof errorOrMessage === 'string' ? errorOrMessage : errorMessage(errorOrMessage),
          title,
        }),
    }),
    [show, hide],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? <ToastHost key={toast.id} toast={toast} onDone={dismiss} /> : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

/** Renders one toast; animates in, waits, animates out, then calls onDone. */
function ToastHost({ toast, onDone }: { toast: ActiveToast; onDone: (id: number) => void }) {
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => onDone(toast.id));
  }, [anim, onDone, toast.id]);

  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 6 }).start();
    const timer = setTimeout(close, toast.durationMs);
    return () => clearTimeout(timer);
  }, [anim, close, toast.durationMs]);

  const { icon, color } = TYPE_STYLE[toast.type];
  const card = (
    <Animated.View
      style={[
        styles.container,
        { top: insets.top + spacing.sm },
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
        },
      ]}
    >
      <Pressable
        onPress={close}
        accessibilityRole="alert"
        accessibilityLabel={[toast.title, toast.message].filter(Boolean).join('. ')}
        accessibilityHint="Tap to dismiss"
        style={[styles.card, { borderColor: withAlpha(color, 0.45) }]}
      >
        <View style={[styles.iconWrap, { backgroundColor: withAlpha(color, 0.16) }]}>
          <Ionicons name={icon} size={20} color={color} />
        </View>
        <View style={styles.text}>
          {toast.title ? (
            <AppText variant="body" weight="700" numberOfLines={1}>
              {toast.title}
            </AppText>
          ) : null}
          <AppText variant={toast.title ? 'caption' : 'body'} tone={toast.title ? 'muted' : 'default'} numberOfLines={3}>
            {toast.message}
          </AppText>
        </View>
      </Pressable>
    </Animated.View>
  );

  // FullWindowOverlay (iOS) floats above native modal screens; its only child is the toast card,
  // so it never blocks touches elsewhere. Android modals live in the same window, so a View works.
  if (Platform.OS === 'ios') return <FullWindowOverlay>{card}</FullWindowOverlay>;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {card}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 1000,
    elevation: 1000,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    ...shadows.floating,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  text: { flex: 1 },
});
