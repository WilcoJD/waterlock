/**
 * Card-by-card reveal after a rip: tap the face-down card to flip it, see its value count up with a
 * tier glow (and a burst for big hits), tap again for the next card. "Skip" jumps to the summary.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { formatPence, pullOutcome } from '@ripvault/shared';
import type { Pull } from '@ripvault/shared';
import { CARD_ASPECT, colors, spacing } from '../../theme.ts';
import { AppText, Button } from '../../components/index.ts';
import { haptic } from '../../lib/haptics.ts';
import { Burst } from './Burst.tsx';
import { CardBack } from './CardBack.tsx';
import { CountUpMoney } from './CountUpMoney.tsx';
import { OutcomeBadge } from './OutcomeBadge.tsx';
import { RevealCard } from './RevealCard.tsx';
import { hitMultiple } from './packData.ts';

export interface RevealStageProps {
  /** Pulls in reveal order. */
  pulls: readonly Pull[];
  packPricePence: number;
  /** After the last card (or Skip). */
  onFinished: () => void;
  /** Extra bottom padding (home indicator). */
  bottomInset?: number;
}

type CardStage = 'hidden' | 'flipping' | 'shown' | 'leaving';

/** Height reserved under the card for the outcome, name, value and button (so the card never jumps). */
const DETAILS_HEIGHT = 196;

export function RevealStage({ pulls, packPricePence, onFinished, bottomInset = 0 }: RevealStageProps) {
  const { width: windowWidth } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<CardStage>('hidden');
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const finishedRef = useRef(false);

  const pull = pulls[index];
  const isLast = index >= pulls.length - 1;
  const outcome = pull ? pullOutcome(pull.valuePence, packPricePence) : 'loss';
  // A fresh exit value per card, so the next card never inherits the previous card's fly-out.
  const exit = useMemo(() => new Animated.Value(0), [index]);

  const cardWidth = area
    ? Math.floor(Math.min(area.width * 0.74, (area.height - spacing.xl) / CARD_ASPECT, 340))
    : 0;

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinished();
  }, [onFinished]);

  // Nothing to reveal (should not happen): go straight to the summary instead of a blank stage.
  useEffect(() => {
    if (pulls.length === 0) finish();
  }, [pulls.length, finish]);

  const onFlipped = useCallback(() => {
    setStage('shown');
    if (outcome === 'loss') haptic.tap();
    else haptic.success();
  }, [outcome]);

  const advance = useCallback(() => {
    if (stage !== 'shown') return;
    if (isLast) {
      finish();
      return;
    }
    setStage('leaving');
    haptic.selection();
    Animated.timing(exit, { toValue: 1, duration: 300, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
      setIndex((i) => i + 1);
      setStage('hidden');
    });
  }, [stage, isLast, finish, exit]);

  const onPressCard = useCallback(() => {
    if (stage === 'hidden') {
      haptic.medium();
      setStage('flipping');
    } else if (stage === 'shown') {
      advance();
    }
  }, [stage, advance]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea((prev) => (prev && Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1 ? prev : { width, height }));
  };

  if (!pull) return null;

  const exitX = exit.interpolate({ inputRange: [0, 1], outputRange: [0, -windowWidth] });
  const exitRotate = exit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-16deg'] });
  const exitOpacity = exit.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] });
  const remaining = pulls.length - index - 1;
  const multiple = hitMultiple(pull.valuePence, packPricePence);
  const revealed = stage !== 'hidden';

  return (
    <View style={[styles.root, { paddingBottom: bottomInset }]}>
      <View style={styles.topRow}>
        <View style={styles.progress} accessible accessibilityLabel={`Card ${index + 1} of ${pulls.length}`}>
          <AppText variant="label">
            Card {index + 1} of {pulls.length}
          </AppText>
          <View style={styles.progressDots}>
            {pulls.map((p, i) => (
              <View
                key={p.inventoryItemId}
                style={[styles.progressDot, i < index || (i === index && stage === 'shown') ? styles.progressDotDone : null, i === index ? styles.progressDotCurrent : null]}
              />
            ))}
          </View>
        </View>
        {pulls.length > 1 && !(isLast && stage === 'shown') ? (
          <Button title="Skip" variant="ghost" size="sm" iconRight="play-skip-forward" onPress={finish} accessibilityHint="Shows all your cards at once" />
        ) : null}
      </View>

      <View style={styles.stage} onLayout={onLayout}>
        {area && cardWidth > 0 ? (
          <>
            {/* The rest of the deck, waiting behind. */}
            {remaining > 1 ? (
              <View style={[styles.deckCard, { transform: [{ translateY: deckOffset(cardWidth, 0.88, 2) }, { scale: 0.88 }], opacity: 0.45 }]} pointerEvents="none">
                <CardBack width={cardWidth} />
              </View>
            ) : null}
            {remaining > 0 ? (
              <View style={[styles.deckCard, { transform: [{ translateY: deckOffset(cardWidth, 0.94, 1) }, { scale: 0.94 }], opacity: 0.75 }]} pointerEvents="none">
                <CardBack width={cardWidth} />
              </View>
            ) : null}

            {stage === 'shown' && outcome === 'big_win' ? (
              <View style={styles.burst} pointerEvents="none">
                <Burst key={index} size={cardWidth * 1.9} />
              </View>
            ) : null}

            <Animated.View
              key={pull.inventoryItemId}
              style={{ opacity: exitOpacity, transform: [{ translateX: exitX }, { rotate: exitRotate }] }}
            >
              <RevealCard
                card={pull.card}
                width={cardWidth}
                revealed={revealed}
                onPress={onPressCard}
                onFlipped={onFlipped}
                accessibilityHint={revealed ? (isLast ? 'Shows the summary' : 'Shows the next card') : 'Flips the card'}
              />
            </Animated.View>
          </>
        ) : null}
      </View>

      <View style={styles.details}>
        {stage === 'hidden' ? (
          <TapHint />
        ) : stage === 'shown' || stage === 'leaving' ? (
          <View style={styles.detailsInner} key={pull.inventoryItemId} accessibilityLiveRegion="polite">
            <OutcomeBadge outcome={outcome} tier={pull.card.tier} />
            <AppText variant="heading" align="center" numberOfLines={1} style={styles.name}>
              {pull.card.name}
            </AppText>
            <AppText variant="caption" tone="muted" align="center" numberOfLines={1}>
              {pull.card.setName} · #{pull.card.number}
              {multiple ? ` · ${multiple} the pack` : ''}
            </AppText>
            <CountUpMoney
              pence={pull.valuePence}
              variant="display"
              size={38}
              align="center"
              color={outcome === 'big_win' ? colors.gold : outcome === 'win' ? colors.success : colors.text}
              durationMs={outcome === 'big_win' ? 1400 : 800}
              style={styles.value}
            />
            <AppText variant="caption" tone="faint" align="center">
              Sell back now for {formatPence(pull.buybackPence)}
            </AppText>
            <Button
              title={isLast ? 'See all your pulls' : 'Next card'}
              iconRight={isLast ? 'albums-outline' : 'arrow-forward'}
              variant={isLast ? 'holo' : 'secondary'}
              size="md"
              onPress={advance}
              disabled={stage !== 'shown'}
              style={styles.next}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** How far a scaled deck card must drop so its bottom edge peeks out below the card in front. */
function deckOffset(cardWidth: number, scale: number, depth: number): number {
  const cardHeight = cardWidth * CARD_ASPECT;
  return Math.round((cardHeight * (1 - scale)) / 2 + depth * 9);
}

/** "Tap to reveal" with a gentle bob. */
function TapHint() {
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob]);
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });
  return (
    <View style={styles.hint}>
      <Animated.View style={{ transform: [{ translateY }] }}>
        <AppText variant="heading" tone="gold" align="center">
          Tap the card to reveal
        </AppText>
      </Animated.View>
      <AppText variant="caption" tone="muted" align="center" style={styles.hintSub}>
        It's already in your vault, worth its live market value.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.gutter,
    minHeight: 44,
  },
  progress: { flex: 1 },
  progressDots: { flexDirection: 'row', marginTop: 6, flexWrap: 'wrap' },
  progressDot: {
    width: 14,
    height: 4,
    borderRadius: 2,
    marginRight: 4,
    backgroundColor: colors.border,
  },
  progressDotDone: { backgroundColor: colors.gold },
  progressDotCurrent: { width: 22 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  deckCard: { position: 'absolute' },
  burst: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  details: {
    height: DETAILS_HEIGHT,
    paddingHorizontal: spacing.gutter,
    justifyContent: 'flex-start',
  },
  detailsInner: { alignItems: 'center' },
  name: { marginTop: spacing.sm },
  value: { marginTop: spacing.xs },
  next: { marginTop: spacing.md, alignSelf: 'center', minWidth: 200 },
  hint: { paddingTop: spacing.xl, alignItems: 'center' },
  hintSub: { marginTop: spacing.xs, maxWidth: 280 },
});
