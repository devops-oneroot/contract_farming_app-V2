import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { VerticalGradient } from '@/components/vertical-gradient';
import { Brand, CardShadow, Radius, Spacing } from '@/constants/theme';
import { useContentWidth } from '@/hooks/use-content-width';

const ADVANCE_MS = 4500;
// After a swipe, wait this long before advancing on its own again.
const RESUME_MS = 8000;
const GAP = 12;
// How much of the next card shows at the right edge: the cue that it scrolls.
const PEEK = 28;
const ASPECT = 1.85;

type Slide =
  | { kind: 'photo'; key: string; image: number; tag: string; title: string; sub: string }
  /** Artwork that carries its own words - shown as it is, nothing laid over it. */
  | { kind: 'art'; key: string; image: number }
  | { kind: 'promise'; key: string; image: number };

const SLIDES: Slide[] = [
  {
    kind: 'photo',
    key: 'partner',
    image: require('@/assets/images/banners/partnership.jpg'),
    tag: 'In the field',
    title: 'Your field partner',
    sub: 'Visit, advise and record - all in one app.',
  },
  { kind: 'art', key: 'india', image: require('@/assets/images/banners/contract-farming.jpg') },
  { kind: 'promise', key: 'promise', image: require('@/assets/images/banners/field-exec.png') },
];

const PROMISES = ['Assured market', 'Fair price', 'Expert guidance'];

/**
 * The home screen's featured strip: OneRoot's campaign photos and promise, as
 * cards with the next one peeking in. Advances on its own, holds still while
 * someone is swiping, and snaps card by card.
 */
export function FeaturedCarousel() {
  const width = useContentWidth();
  const cardW = width - Spacing.four * 2 - PEEK;
  const cardH = Math.round(cardW / ASPECT);
  const step = cardW + GAP;

  const ref = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const holdUntil = useRef(0);

  const goTo = useCallback(
    (i: number) => {
      indexRef.current = i;
      setIndex(i);
      ref.current?.scrollTo({ x: i * step, animated: true });
    },
    [step]
  );

  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() < holdUntil.current) return;
      goTo((indexRef.current + 1) % SLIDES.length);
    }, ADVANCE_MS);
    return () => clearInterval(id);
  }, [goTo]);

  return (
    <View>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        // Breaks out of the screen's side padding, so cards scroll edge to edge.
        style={{ marginHorizontal: -Spacing.four }}
        contentContainerStyle={{ paddingHorizontal: Spacing.four, gap: GAP }}
        onScrollBeginDrag={() => {
          holdUntil.current = Date.now() + RESUME_MS;
        }}
        onMomentumScrollEnd={(e) => {
          const i = Math.max(0, Math.min(SLIDES.length - 1, Math.round(e.nativeEvent.contentOffset.x / step)));
          indexRef.current = i;
          setIndex(i);
        }}>
        {SLIDES.map((s) => (
          <View key={s.key} style={[styles.card, { width: cardW, height: cardH }]}>
            {s.kind === 'photo' && (
              <>
                <Image source={s.image} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
                <VerticalGradient
                  stops={[
                    [0, [0, 0, 0, 0]],
                    [0.4, [40, 18, 0, 0.15]],
                    [1, [40, 18, 0, 0.85]],
                  ]}
                />
                <View style={styles.caption}>
                  <View style={styles.tag}>
                    <ThemedText style={styles.tagText}>{s.tag}</ThemedText>
                  </View>
                  <ThemedText style={styles.title} numberOfLines={1}>
                    {s.title}
                  </ThemedText>
                  <ThemedText style={styles.sub} numberOfLines={1}>
                    {s.sub}
                  </ThemedText>
                </View>
              </>
            )}

            {s.kind === 'art' && (
              <Image source={s.image} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
            )}

            {s.kind === 'promise' && (
              <View style={styles.promise}>
                {/* Decoration: soft circles behind the illustration. */}
                <View style={[styles.ring, { width: cardH * 1.3, height: cardH * 1.3, right: -cardH * 0.35 }]} />
                <View style={[styles.ring, { width: cardH * 0.9, height: cardH * 0.9, right: -cardH * 0.1 }]} />
                <View style={styles.promiseText}>
                  <View style={[styles.tag, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                    <Ionicons name="ribbon" size={11} color="#fff" />
                    <ThemedText style={styles.tagText}>Why OneRoot</ThemedText>
                  </View>
                  <ThemedText style={styles.title}>Contract farming, done right</ThemedText>
                  <View style={{ gap: 4, marginTop: 2 }}>
                    {PROMISES.map((p) => (
                      <View key={p} style={styles.point}>
                        <Ionicons name="checkmark-circle" size={14} color="#fff" />
                        <ThemedText style={styles.pointText}>{p}</ThemedText>
                      </View>
                    ))}
                  </View>
                </View>
                <Image
                  source={s.image}
                  style={[styles.person, { height: cardH * 0.92, width: cardH * 0.92 * (344 / 360) }]}
                  contentFit="contain"
                />
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {SLIDES.map((s, i) => (
          <View key={s.key} style={[styles.dot, i === index && styles.dotOn]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    overflow: 'hidden',
    backgroundColor: Brand.primarySurface,
    ...CardShadow,
  },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.three, gap: 2 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    backgroundColor: Brand.primary,
    marginBottom: 4,
  },
  tagText: { color: '#fff', fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 0.4 },
  title: { color: '#fff', fontSize: 18, lineHeight: 23, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.88)', fontSize: 12, lineHeight: 16, fontWeight: '600' },

  promise: { flex: 1, backgroundColor: Brand.primaryDark, flexDirection: 'row', alignItems: 'center' },
  ring: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  promiseText: { flex: 1, paddingLeft: Spacing.three, paddingVertical: Spacing.three, gap: 2, zIndex: 1 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pointText: { color: '#fff', fontSize: 12, lineHeight: 16, fontWeight: '700' },
  person: { alignSelf: 'flex-end', marginRight: 4 },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: Spacing.three },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,127,0,0.25)' },
  dotOn: { width: 22, backgroundColor: Brand.primary },
});
