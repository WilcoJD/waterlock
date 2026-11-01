import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing, withAlpha } from '../../theme.ts';
import { AppText, Button } from '../../components/index.ts';
import type { RipErrorAction, RipErrorCopy } from './ripErrors.ts';

export interface RipErrorViewProps {
  copy: RipErrorCopy;
  onAction: (action: RipErrorAction) => void;
  /** Spinner on a retry button. */
  busy?: boolean;
}

const TONE: Record<RipErrorCopy['tone'], string> = {
  danger: colors.danger,
  gold: colors.gold,
  violet: colors.violet,
};

/** Why the rip did not happen, and the one obvious next step (top up, limits, retry...). */
export function RipErrorView({ copy, onAction, busy = false }: RipErrorViewProps) {
  const tone = TONE[copy.tone];
  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      <View style={[styles.medallion, { borderColor: withAlpha(tone, 0.5), backgroundColor: withAlpha(tone, 0.12) }]}>
        <Ionicons name={copy.icon} size={32} color={tone} />
      </View>
      <AppText variant="title" size={24} align="center" style={styles.title}>
        {copy.title}
      </AppText>
      <AppText variant="body" tone="muted" align="center" style={styles.message}>
        {copy.message}
      </AppText>
      <View style={styles.actions}>
        <Button
          title={copy.primary.label}
          icon={copy.primary.icon}
          variant={copy.primary.action === 'close' ? 'secondary' : 'holo'}
          size="lg"
          block
          loading={busy && copy.primary.action === 'retry'}
          onPress={() => onAction(copy.primary.action)}
        />
        {copy.secondary ? (
          <Button
            title={copy.secondary.label}
            icon={copy.secondary.icon}
            variant={copy.secondary.action === 'close' ? 'ghost' : 'secondary'}
            size="md"
            block
            loading={busy && copy.secondary.action === 'retry'}
            onPress={() => {
              const secondary = copy.secondary;
              if (secondary) onAction(secondary.action);
            }}
            style={styles.secondary}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: spacing.xl },
  medallion: {
    width: 76,
    height: 76,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: { marginBottom: spacing.sm },
  message: { maxWidth: 340 },
  actions: { alignSelf: 'stretch', marginTop: spacing.xl },
  secondary: { marginTop: spacing.sm },
});
