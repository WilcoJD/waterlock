/**
 * Profile tab: identity, collector stats, and the account menu (shipments, history, fairness,
 * safer play, edit profile, help, sign out). Refreshes /me on focus and on pull-to-refresh.
 */
import { Alert, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useSession } from '../../src/state/session.tsx';
import { colors, spacing, tierColors } from '../../src/theme.ts';
import { SUPPORT_LINKS } from '../../src/config.ts';
import { formatDateTime, formatTimeUntil } from '../../src/lib/format.ts';
import { haptic } from '../../src/lib/haptics.ts';
import {
  AppHeader,
  AppText,
  Button,
  IconButton,
  ListRow,
  LoadingState,
  MoneyText,
  Pill,
  Screen,
  SectionHeader,
} from '../../src/components/index.ts';
import { formatCount, formatMonthYear } from '../../src/features/account/format.ts';
import { isCoolingOff, limitLabel } from '../../src/features/account/limits.ts';
import { useOpenLink, useUserRefresh } from '../../src/features/account/hooks.ts';
import { Avatar, ListGroup, Note, StatTile } from '../../src/features/account/ui.tsx';

export default function ProfileScreen() {
  const { user, signOut } = useSession();
  const { refreshing, onRefresh } = useUserRefresh();
  const openLink = useOpenLink();

  if (!user) {
    return (
      <Screen header={<AppHeader />}>
        <LoadingState />
      </Screen>
    );
  }

  const { stats, limits } = user;
  const onBreak = isCoolingOff(limits);
  const version = Constants.expoConfig?.version;

  const confirmSignOut = () => {
    haptic.warning();
    Alert.alert('Sign out?', 'Your cards stay safe in your vault. You can sign back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <Screen header={<AppHeader />} scroll refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.identity}>
        <Avatar name={user.displayName} size={76} />
        <View style={styles.identityText}>
          <AppText variant="title" size={24} numberOfLines={1} adjustsFontSizeToFit>
            {user.displayName}
          </AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {user.email}
          </AppText>
          <Pill
            label={`Collector since ${formatMonthYear(user.createdAt)}`}
            color={colors.gold}
            icon="ribbon-outline"
            style={styles.since}
          />
        </View>
        <IconButton icon="create-outline" accessibilityLabel="Edit profile" onPress={() => router.push('/edit-profile')} />
      </View>

      {onBreak && limits.coolingOffUntil ? (
        <Note
          icon="cafe"
          color={colors.gold}
          style={styles.block}
          action={<Button title="Details" variant="ghost" size="sm" onPress={() => router.push('/limits')} />}
        >
          <AppText variant="body" weight="700">
            On a break
          </AppText>
          <AppText variant="caption" tone="muted">
            Until {formatDateTime(limits.coolingOffUntil)} ({formatTimeUntil(limits.coolingOffUntil)} left)
          </AppText>
        </Note>
      ) : null}

      <SectionHeader title="Your collection" style={styles.section} />
      <View style={styles.grid}>
        <View style={styles.cell}>
          <StatTile label="Packs opened" icon="layers" color={colors.violet}>
            <AppText variant="money" size={26}>
              {formatCount(stats.packsOpened)}
            </AppText>
          </StatTile>
        </View>
        <View style={styles.cell}>
          <StatTile label="In vault" icon="cube" color={colors.info}>
            <AppText variant="money" size={26}>
              {formatCount(stats.cardsInVault)}
            </AppText>
          </StatTile>
        </View>
        <View style={styles.cell}>
          <StatTile label="Vault value" icon="diamond" color={colors.gold}>
            <MoneyText pence={stats.vaultValuePence} size={22} adjustsFontSizeToFit color={colors.gold} />
          </StatTile>
        </View>
        <View style={styles.cell}>
          <StatTile label="Biggest pull" icon="trophy" color={tierColors.legendary}>
            <MoneyText pence={stats.biggestPullPence} size={22} adjustsFontSizeToFit />
          </StatTile>
        </View>
        <View style={styles.cellWide}>
          <StatTile label="Total spent on packs" icon="stats-chart" color={tierColors.epic}>
            <MoneyText pence={stats.totalSpentPence} size={22} />
          </StatTile>
        </View>
      </View>

      <SectionHeader title="Collection" style={styles.section} />
      <ListGroup>
        <ListRow icon="paper-plane" iconColor={colors.info} title="Shipments" subtitle="Cards on their way to you" onPress={() => router.push('/shipments')} />
        <ListRow
          icon="time"
          iconColor={colors.violet}
          title="Pull history & verification"
          subtitle="Every pack you've opened, with proofs"
          onPress={() => router.push('/history')}
        />
      </ListGroup>

      <SectionHeader title="Fair & safe play" style={styles.section} />
      <ListGroup>
        <ListRow
          icon="shield-checkmark"
          iconColor={colors.success}
          title="Provably fair seeds"
          subtitle="Your seeds, nonce and rotation"
          onPress={() => router.push('/fairness')}
        />
        <ListRow
          icon="hand-left"
          iconColor={colors.gold}
          title="Safer play limits"
          subtitle={onBreak ? 'On a break' : 'Daily pack limit and breaks'}
          value={limitLabel(limits.dailySpendLimitPence)}
          valueTone={limits.dailySpendLimitPence === null ? 'faint' : 'default'}
          valueCaption={limits.dailySpendLimitPence === null ? undefined : 'per day'}
          onPress={() => router.push('/limits')}
        />
        <ListRow
          icon="help-buoy"
          iconColor={colors.info}
          title="Help & responsible play"
          subtitle="Free, confidential support from BeGambleAware"
          right={<IconOpen />}
          chevron={false}
          onPress={() => openLink(SUPPORT_LINKS.beGambleAware)}
        />
      </ListGroup>

      <SectionHeader title="Account" style={styles.section} />
      <ListGroup>
        <ListRow icon="person" iconColor={colors.violet} title="Edit profile" subtitle="Display name" onPress={() => router.push('/edit-profile')} />
        <ListRow icon="log-out-outline" title="Sign out" destructive chevron={false} onPress={confirmSignOut} />
      </ListGroup>

      <AppText variant="caption" tone="faint" align="center" style={styles.footer}>
        RipVault{version ? ` ${version}` : ''} · 18+ · Please play responsibly
      </AppText>
    </Screen>
  );
}

function IconOpen() {
  return <Ionicons name="open-outline" size={18} color={colors.textFaint} style={styles.openIcon} />;
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  identityText: { flex: 1, minWidth: 0, marginHorizontal: spacing.lg },
  since: { marginTop: spacing.sm },
  block: { marginTop: spacing.lg },
  section: { marginTop: spacing.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  cell: { width: '50%', padding: spacing.xs },
  cellWide: { width: '100%', padding: spacing.xs },
  openIcon: { marginLeft: spacing.sm },
  footer: { marginTop: spacing.xxl },
});
