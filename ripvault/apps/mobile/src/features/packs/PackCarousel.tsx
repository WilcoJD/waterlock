/**
 * Horizontal snapping pack carousel: the focused pack is full size with a coloured spotlight, its
 * neighbours peek in from the sides, smaller and dimmed. Pagination dots follow the scroll.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { ElementRef } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { formatPence } from '@ripvault/shared';
import type { PackSummary } from '@ripvault/shared';
import { colors, spacing, withAlpha } from '../../theme.ts';
import { PressableScale } from '../../components/index.ts';
import { haptic } from '../../lib/haptics.ts';
import { PackArt, packArtHeight } from './PackArt.tsx';
import { safePackTheme } from './packData.ts';

/** Carousel geometry for a window width. */
export function carouselMetrics(windowWidth: number) {
  const itemWidth = Math.round(Math.min(windowWidth * 0.62, 300));
  const packWidth = Math.round(itemWidth * 0.86);
  const sidePadding = Math.round((windowWidth - itemWidth) / 2);
  const height = packArtHeight(packWidth, true) + spacing.xl + spacing.md;
  return { itemWidth, packWidth, sidePadding, height };
}

export interface PackCarouselProps {
  packs: readonly PackSummary[];
  /** Focused pack index (controlled). */
  index: number;
  onIndexChange: (index: number) => void;
  /** The focused pack was tapped (e.g. open its odds). */
  onPressPack: (pack: PackSummary) => void;
}

export function PackCarousel({ packs, index, onIndexChange, onPressPack }: PackCarouselProps) {
  const { width: windowWidth } = useWindowDimensions();
  const { itemWidth, packWidth, sidePadding, height } = carouselMetrics(windowWidth);
  const scrollX = useRef(new Animated.Value(index * itemWidth)).current;
  // Initial position only: a changing contentOffset prop would make the native scroll view jump.
  const initialOffset = useRef({ x: index * itemWidth, y: 0 }).current;
  // Animated.FlatList forwards its ref to the underlying FlatList.
  const listRef = useRef<ElementRef<typeof FlatList>>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const onIndexChangeRef = useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;
  const countRef = useRef(packs.length);
  countRef.current = packs.length;

  const settle = useCallback(
    (offsetX: number, withHaptic: boolean) => {
      const next = Math.min(Math.max(0, Math.round(offsetX / itemWidth)), Math.max(0, countRef.current - 1));
      if (next !== indexRef.current) {
        indexRef.current = next;
        if (withHaptic) haptic.selection();
        onIndexChangeRef.current(next);
      }
    },
    [itemWidth],
  );

  const settleRef = useRef(settle);
  settleRef.current = settle;
  // Scroll position drives every transform on the native thread; the JS listener only tracks the
  // focused index (dots, pack info, haptic tick).
  const onScroll = useRef(
    Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
      useNativeDriver: true,
      listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => settleRef.current(e.nativeEvent.contentOffset.x, true),
    }),
  ).current;

  // Keep the scroll position in sync when the index is changed from outside (or the list shrinks).
  useEffect(() => {
    const target = index * itemWidth;
    listRef.current?.scrollToOffset({ offset: target, animated: false });
    // Only when the geometry changes (rotation / font scale); user scrolling drives `index` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemWidth]);

  const scrollTo = (i: number) => {
    listRef.current?.scrollToOffset({ offset: i * itemWidth, animated: true });
  };

  const renderItem = ({ item, index: i }: { item: PackSummary; index: number }) => {
    const inputRange = [(i - 1) * itemWidth, i * itemWidth, (i + 1) * itemWidth];
    const scale = scrollX.interpolate({ inputRange, outputRange: [0.82, 1, 0.82], extrapolate: 'clamp' });
    const opacity = scrollX.interpolate({ inputRange, outputRange: [0.45, 1, 0.45], extrapolate: 'clamp' });
    const translateY = scrollX.interpolate({ inputRange, outputRange: [20, 0, 20], extrapolate: 'clamp' });
    // Pull neighbours slightly towards the centre so more of them peeks in.
    const translateX = scrollX.interpolate({ inputRange, outputRange: [-itemWidth * 0.08, 0, itemWidth * 0.08], extrapolate: 'clamp' });
    const spotlight = scrollX.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' });
    const theme = safePackTheme(item.theme);
    const focused = i === index;
    const label = `${item.name}, ${formatPence(item.pricePence)} per pack${item.soldOut ? ', sold out' : ''}`;

    return (
      <View style={[styles.item, { width: itemWidth, height }]}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.spotlight,
            { width: packWidth * 1.05, height: packWidth * 0.22, borderRadius: packWidth, backgroundColor: withAlpha(theme.accent, 0.32), opacity: spotlight },
          ]}
        />
        <Animated.View style={{ opacity, transform: [{ translateX }, { translateY }, { scale }] }}>
          <PressableScale
            onPress={() => (focused ? onPressPack(item) : scrollTo(i))}
            haptic="tap"
            scaleTo={0.97}
            accessibilityLabel={label}
            accessibilityHint={focused ? 'Shows the odds and every card in this pack' : 'Shows this pack'}
            accessibilityState={{ selected: focused }}
          >
            <PackArt
              name={item.name}
              theme={theme}
              width={packWidth}
              featuredCards={item.featuredCards}
              pricePence={item.pricePence}
              soldOut={item.soldOut}
              shimmer={focused}
            />
          </PressableScale>
        </Animated.View>
      </View>
    );
  };

  return (
    <View>
      <Animated.FlatList
        ref={listRef}
        data={packs}
        keyExtractor={(p: PackSummary) => p.id}
        renderItem={renderItem}
        extraData={index}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={itemWidth}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        contentContainerStyle={{ paddingHorizontal: sidePadding }}
        getItemLayout={(_: unknown, i: number) => ({ length: itemWidth, offset: sidePadding + itemWidth * i, index: i })}
        contentOffset={initialOffset}
        onScroll={onScroll}
        onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => settle(e.nativeEvent.contentOffset.x, false)}
        scrollEventThrottle={16}
        accessibilityRole="list"
      />
      {packs.length > 1 ? <PaginationDots count={packs.length} scrollX={scrollX} itemWidth={itemWidth} /> : null}
    </View>
  );
}

function PaginationDots({ count, scrollX, itemWidth }: { count: number; scrollX: Animated.Value; itemWidth: number }) {
  return (
    <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, i) => {
        const inputRange = [(i - 1) * itemWidth, i * itemWidth, (i + 1) * itemWidth];
        return (
          <View key={i} style={styles.dotSlot}>
            <View style={styles.dot} />
            <Animated.View
              style={[
                styles.dot,
                styles.dotActive,
                {
                  opacity: scrollX.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' }),
                  transform: [{ scaleX: scrollX.interpolate({ inputRange, outputRange: [1, 2.6, 1], extrapolate: 'clamp' }) }],
                },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

const DOT = 7;

const styles = StyleSheet.create({
  item: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: spacing.xl,
  },
  spotlight: {
    position: 'absolute',
    bottom: spacing.sm,
    transform: [{ scaleY: 0.6 }],
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    height: 16,
  },
  dotSlot: {
    width: DOT * 3,
    height: DOT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.borderStrong,
  },
  dotActive: { backgroundColor: colors.gold },
});
