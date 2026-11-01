import type { Tier } from '@ripvault/shared';
import type { StyleProp, ViewStyle } from 'react-native';
import { tierColors, tierLabels, tierRank } from '../theme.ts';
import { Pill } from './Pill.tsx';

export interface TierBadgeProps {
  tier: Tier;
  size?: 'sm' | 'md';
  /** Filled badge instead of tinted (good on top of card art). */
  solid?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Rarity tier chip in the tier colour ("LEGENDARY"). Epic and legendary get a sparkle icon. */
export function TierBadge({ tier, size = 'sm', solid = false, style }: TierBadgeProps) {
  return (
    <Pill
      label={tierLabels[tier]}
      color={tierColors[tier]}
      icon={tierRank[tier] >= tierRank.epic ? 'sparkles' : undefined}
      variant={solid ? 'solid' : 'soft'}
      size={size}
      style={style}
    />
  );
}
