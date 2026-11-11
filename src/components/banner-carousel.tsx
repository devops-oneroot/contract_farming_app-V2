import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/exo-text';

import { Brand, Radius, Spacing } from '@/constants/theme';
import { useContentWidth } from '@/hooks/use-content-width';

export type BannerSlide = {
  image: number;
  /** Optional words over the photo. Leave out on artwork that carries its own title. */
  kicker?: string;
  title?: string;
  cta?: string;
  /** Fill the button in this colour, white text - e.g. red for END. White with brand text by default. */
  ctaColor?: string;
  /** Words under the title. */
  subtitle?: string;
  onPress?: () => void;
};

/** Slides keep this shape at any width, so campaign artwork is never cropped away. */
const SLIDE_ASPECT = 1.9;
/** Each slide fills the width between the screen margins; the gap keeps its neighbours off screen. */
const AUTO_MS = 4000;
/** Shade behind a caption, left to right (the app has no gradient library). */
const SHADE = Array.from({ length: 32 }, (_, i) => +(0.1 + 0.6 * (1 - i / 31) ** 1.3).toFixed(3));

/**
 * Auto-advancing photo slider, card style: each slide rounded and lifted, one
 * at a time across the full width. `pad` is the parent's horizontal padding,
 * so the slider can run to the screen edge. `onDark` for an orange/brand
 * background: white dots instead of orange.
 */
export function BannerCarousel({
  slides,
  pad = Spacing.four,
  onDark = false,
}: {
  slides: BannerSlide[];
  pad?: number;
  onDark?: boolean;
}) {
  const width = useContentWidth();
  // One slide across a phone; two side by side on a tablet, where one slide
  // the full width would be taller than the rest of the first screen.
  const perView = width >= 560 ? 2 : 1;
  // At least the side margin, or the slide after the last one in view shows at the edge.
  const gap = perView > 1 ? pad : pad * 2;
  const slideW = (width - pad * 2 - gap * (perView - 1)) / perView;
  const step = slideW + gap;
  const [slide, setSlide] = useState(0);
  const ref = useRef<ScrollView>(null);
  const idx = useRef(0);
  // A finger on the slider pauses the auto-advance until it lets go.
  const holding = useRef(false);

  // Always forward: after the last slide comes a copy of the first, sliding in
  // from the right like every other step; once it has landed, the view jumps
  // (unseen) back to the real first slide. No rewinding backwards.
  const loop = slides.length > perView;
  const items = loop ? [...slides, ...slides.slice(0, perView)] : slides;

  useEffect(() => {
    if (!width || !loop) return;
    let snapBack: ReturnType<typeof setTimeout> | undefined;
    const id = setInterval(() => {
      if (holding.current) return;
      const next = idx.current + 1;
      ref.current?.scrollTo({ x: next * step, animated: true });
      if (next === slides.length) {
        setSlide(0);
        snapBack = setTimeout(() => {
          ref.current?.scrollTo({ x: 0, animated: false });
          idx.current = 0;
        }, 600);
      } else {
        idx.current = next;
        setSlide(next);
      }
    }, AUTO_MS);
    return () => {
      clearInterval(id);
      if (snapBack) clearTimeout(snapBack);
    };
  }, [width, step, loop, slides.length]);

  return (
    <View style={{ marginHorizontal: -pad }}>
      <ScrollView
        ref={ref}
        horizontal
        decelerationRate="fast"
        snapToInterval={step}
        snapToAlignment="start"
        disableIntervalMomentum
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: pad, gap }}
        onTouchStart={() => (holding.current = true)}
        onTouchEnd={() => (holding.current = false)}
        onMomentumScrollEnd={(e) => {
          const i = Math.min(items.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / step)));
          // Swiped by hand onto the copy of the first slide: move to the real one.
          if (loop && i === slides.length) {
            ref.current?.scrollTo({ x: 0, animated: false });
            idx.current = 0;
            setSlide(0);
            return;
          }
          idx.current = i;
          setSlide(i);
        }}>
        {items.map((s, i) => (
          <Pressable
            key={i}
            onPress={s.onPress}
            disabled={!s.onPress}
            style={({ pressed }) => [styles.card, { width: slideW, height: slideW / SLIDE_ASPECT }, pressed && { opacity: 0.92 }]}>
            <Image source={s.image} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
            {s.title ? (
              <>
                <View pointerEvents="none" style={styles.shade}>
                  {SHADE.map((o, k) => (
                    <View key={k} style={{ flex: 1, backgroundColor: `rgba(0,0,0,${o})` }} />
                  ))}
                </View>
                <View style={styles.caption}>
                  {s.kicker ? <Text style={styles.kicker}>{s.kicker}</Text> : null}
                  <Text style={styles.title} numberOfLines={2}>
                    {s.title}
                  </Text>
                  {s.subtitle ? (
                    <Text style={styles.subtitle} numberOfLines={1}>
                      {s.subtitle}
                    </Text>
                  ) : null}
                  {s.cta ? (
                    <View style={[styles.cta, s.ctaColor ? { backgroundColor: s.ctaColor } : null]}>
                      <Text style={[styles.ctaText, s.ctaColor ? { color: '#fff' } : null]}>{s.cta}</Text>
                      <Ionicons name="arrow-forward" size={13} color={s.ctaColor ? '#fff' : Brand.primaryDark} />
                    </View>
                  ) : null}
                </View>
              </>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
      {slides.length > 1 ? (
        <View style={styles.dots}>
          {slides.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: onDark ? 'rgba(255,255,255,0.45)' : 'rgba(255,127,0,0.3)' },
                i === slide && [styles.dotActive, { backgroundColor: onDark ? '#fff' : Brand.primary }],
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    overflow: 'hidden',
    backgroundColor: Brand.primarySurface,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  shade: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
  caption: { flex: 1, justifyContent: 'flex-end', padding: Spacing.three },
  kicker: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  title: { color: '#fff', fontSize: 17, lineHeight: 22, fontWeight: '800', maxWidth: '72%', marginTop: 2 },
  subtitle: { color: 'rgba(255,255,255,0.88)', fontSize: 12, fontWeight: '600', marginTop: 2, maxWidth: '72%' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    backgroundColor: '#fff',
  },
  ctaText: { color: Brand.primaryDark, fontSize: 13, fontWeight: '800' },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: Spacing.three },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotActive: { width: 20 },
});
