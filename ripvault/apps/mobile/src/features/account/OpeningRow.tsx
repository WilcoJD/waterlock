import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatPence } from '@ripvault/shared';
import type { Opening } from '@ripvault/shared';
import { colors, radii, spacing } from '../../theme.ts';
import { AppText, CardArt, MoneyText, Pill, PressableScale } from '../../components/index.ts';
import type { IconName } from '../../components/index.ts';
import { formatDateTime, formatRelative } from '../../lib/format.ts';
import { quickCheck } from './verification.ts';
import type { QuickStatus } from './verification.ts';

export const QUICK_STATUS_META: Readonly<Record<QuickStatus, { label: string; icon: IconName; color: string; a11y: string }>> = {
  verified: {
    label: 'Verified',
    icon: 'checkmark-circle',
    color: colors.success,
    a11y: 'Verified on this device: the revealed seed matches its hash and reproduces the roll',
  },
  mismatch: { label: 'Check failed', icon: 'alert-circle', color: colors.danger, a11y: 'The fairness check did not match' },
  pending: { label: 'Pending reveal', icon: 'time-outline', color: colors.gold, a11y: 'Verifiable after you rotate your seeds' },
};

export interface OpeningRowProps {
  opening: Opening;
  onPress: (openingId: string) => void;
}

/** History row: card thumb, card + pack, value, nonce, date and a fairness chip. Tap to verify. */
export const OpeningRow = memo(function OpeningRow({ opening, onPress }: OpeningRowProps) {
  const { serverSeed, serverSeedHash, clientSeed, nonce, roll } = opening;
  // Cheap on-device check (hash + roll); the verify screen also checks the card against the odds.
  const status = useMemo(
    () => quickCheck({ serverSeed, serverSeedHash, clientSeed, nonce, roll }),
    [serverSeed, serverSeedHash, clientSeed, nonce, roll],
  );
  const meta = QUICK_STATUS_META[status];
  const label = `${opening.card.name} from ${opening.pack.name}, worth ${formatPence(opening.valuePence)}, nonce ${nonce}, ${formatDateTime(
    opening.createdAt,
  )}. ${meta.a11y}.`;
  return (
    <PressableScale
      onPress={() => onPress(opening.id)}
      haptic="tap"
      scaleTo={0.985}
      accessibilityLabel={label}
      accessibilityHint="Opens the fairness proof"
      style={styles.row}
    >
      <CardArt card={opening.card} size="xs" />
      <View style={styles.middle}>
        <AppText variant="body" weight="700" numberOfLines={1}>
          {opening.card.name}
        </AppText>
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {opening.pack.name} · {formatRelative(opening.createdAt)}
        </AppText>
        <View style={styles.chips}>
          <Pill label={meta.label} icon={meta.icon} color={meta.color} />
          <AppText variant="caption" size={11} tone="faint" style={styles.nonce}>
            Nonce #{nonce}
          </AppText>
        </View>
      </View>
      <View style={styles.right}>
        <MoneyText pence={opening.valuePence} size={16} />
        <AppText variant="caption" size={11} tone="faint">
          paid {formatPence(opening.pricePence)}
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} style={styles.chevron} />
    </PressableScale>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  middle: { flex: 1, minWidth: 0, marginLeft: spacing.md },
  chips: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  nonce: { marginLeft: spacing.sm },
  right: { alignItems: 'flex-end', marginLeft: spacing.sm },
  chevron: { marginLeft: spacing.xs },
});
