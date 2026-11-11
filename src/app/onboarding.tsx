import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/exo-text';
import { SafeAreaView } from '@/components/safe-area-view';

import { useContentWidth } from '@/hooks/use-content-width';
import { AUTH } from '@/components/auth-scaffold';
import { LogoAspect, Logos } from '@/constants/theme';
import { useAuth } from '@/context/auth';


const SLIDES = [
  {
    image: require('@/assets/images/img2.png'),
    title: 'Grow with a plan',
    text: 'Follow a simple day-by-day Package of Practices for every crop you grow.',
  },
  {
    image: require('@/assets/images/img3.png'),
    title: 'Right inputs, right time',
    text: 'Know exactly which products to use — and on which day — for a healthy harvest.',
  },
  {
    image: require('@/assets/images/img4.png'),
    title: 'Expert support',
    text: 'Your agronomist tracks your farm and guides you every step of the way.',
  },
];

export default function OnboardingScreen() {
  const { height } = useWindowDimensions();
  const width = useContentWidth();
  const router = useRouter();
  const { completeOnboarding, user } = useAuth();
  const ref = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;
  const imageHeight = Math.round(height * 0.4);

  const finish = async () => {
    await completeOnboarding();
    // `user` is set only on a replay from Profile — first-run viewers still go on to sign in.
    router.replace(user ? '/' : '/login');
  };

  const next = () => {
    if (last) finish();
    else ref.current?.scrollTo({ x: (index + 1) * width, animated: true });
  };

  return (
    <View style={[styles.container, { backgroundColor: AUTH.bg }]}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* Brand + Skip */}
        <View style={styles.topBar}>
          <View style={styles.brand}>
            <Image source={Logos.horizontal} style={styles.brandLogo} contentFit="contain" accessibilityLabel="OneRoot" />
          </View>
          <Pressable onPress={finish} hitSlop={10} style={{ opacity: last ? 0 : 1 }} disabled={last}>
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
        </View>

        <ScrollView
          ref={ref}
          horizontal
          pagingEnabled
          style={{ flex: 1 }}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}>
          {SLIDES.map((s, i) => (
            <View key={i} style={[styles.slide, { width }]}>
              <View style={[styles.imageCard, { height: imageHeight }]}>
                <Image source={s.image} style={styles.image} contentFit="cover" />
              </View>
              <View style={styles.stepTag}>
                <Text style={styles.stepTagText}>{`STEP ${i + 1} OF ${SLIDES.length}`}</Text>
              </View>
              <Text style={styles.title}>{s.title}</Text>
              <Text style={styles.text}>{s.text}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Dots */}
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>

        {/* Action */}
        <View style={styles.footer}>
          <Pressable onPress={next} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}>
            <Text style={styles.btnText}>{last ? 'Get Started' : 'Next'}</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </Pressable>
          <Text style={styles.footNote}>Contract farming, simplified.</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    height: 48,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandLogo: { height: 24, width: 24 * LogoAspect.horizontal },
  skip: { color: AUTH.subtitle, fontSize: 15, fontWeight: '600' },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26, gap: 8 },
  imageCard: {
    width: '100%',
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#fff',
    shadowColor: '#0b3d1f',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 6,
  },
  image: { width: '100%', height: '100%' },
  stepTag: {
    marginTop: 26,
    backgroundColor: 'rgba(21,58,31,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  stepTagText: { color: AUTH.btn, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  title: { fontSize: 27, fontWeight: '800', color: AUTH.heading, marginTop: 8, textAlign: 'center' },
  text: { fontSize: 16, color: AUTH.subtitle, marginTop: 6, textAlign: 'center', lineHeight: 23 },
  dots: { flexDirection: 'row', gap: 7, justifyContent: 'center', marginVertical: 18 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(21,58,31,0.2)' },
  dotActive: { width: 24, backgroundColor: AUTH.btn },
  footer: { paddingHorizontal: 22, paddingBottom: 14, gap: 12 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: AUTH.btn,
    borderRadius: 16,
    paddingVertical: 17,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  footNote: { textAlign: 'center', color: AUTH.subtitle, fontSize: 13 },
});
