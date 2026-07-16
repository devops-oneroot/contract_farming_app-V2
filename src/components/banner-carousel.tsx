import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Spacing } from '@/constants/theme';

const IMAGES = [
  require('@/assets/images/img4.png'),
  require('@/assets/images/img2.png'),
  require('@/assets/images/img3.png'),
];
const GREEN = '#2e9e5b';

// Full-bleed auto-advancing image slider. `pad` = the parent's horizontal
// padding, so the slider can break out to the full screen width.
export function BannerCarousel({ pad = Spacing.four }: { pad?: number }) {
  const { width } = useWindowDimensions();
  const [slide, setSlide] = useState(0);
  const ref = useRef<ScrollView>(null);
  const idx = useRef(0);

  useEffect(() => {
    if (!width) return;
    const id = setInterval(() => {
      const next = (idx.current + 1) % IMAGES.length;
      idx.current = next;
      ref.current?.scrollTo({ x: next * width, animated: true });
      setSlide(next);
    }, 3500);
    return () => clearInterval(id);
  }, [width]);

  return (
    <View style={{ marginHorizontal: -pad }}>
      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / width);
          idx.current = i;
          setSlide(i);
        }}>
        {IMAGES.map((src, i) => (
          <View key={i} style={{ width, paddingHorizontal: pad }}>
            <Image source={src} style={styles.img} contentFit="cover" />
          </View>
        ))}
      </ScrollView>
      <View style={styles.dots}>
        {IMAGES.map((_, i) => (
          <View key={i} style={[styles.dot, i === slide && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  img: { width: '100%', height: 170, borderRadius: Spacing.four },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: Spacing.two },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(46,158,91,0.3)' },
  dotActive: { width: 18, backgroundColor: GREEN },
});
