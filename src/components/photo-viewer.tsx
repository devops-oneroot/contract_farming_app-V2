import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image as RNImage,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 280;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

type Touch = { pageX: number; pageY: number };
const spread = (t: Touch[]) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);

/**
 * One photo, pinchable.
 *
 * Deliberately built on Animated + PanResponder, both core React Native, rather
 * than gesture-handler: this ships as an over-the-air update, and core RN needs
 * no native code and no GestureHandlerRootView — which a React Native Modal,
 * being its own native window, would otherwise require.
 */
function ZoomableImage({
  uri,
  width,
  height,
  active,
  onZoomChange,
}: {
  uri: string;
  width: number;
  height: number;
  active: boolean;
  onZoomChange: (zoomed: boolean) => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;

  // An Animated.Value cannot be read synchronously, and every gesture frame
  // needs the current transform, so it is mirrored in refs.
  const s = useRef(1);
  const x = useRef(0);
  const y = useRef(0);

  const startS = useRef(1);
  const startX = useRef(0);
  const startY = useRef(0);
  const startSpread = useRef(0);
  const focal = useRef({ x: 0, y: 0 });
  // Where the finger was when panning took over, so lifting one finger out of a
  // pinch continues from the current position instead of jumping.
  const panFrom = useRef({ dx: 0, dy: 0 });
  const pinching = useRef(false);
  const lastTap = useRef(0);
  const wasZoomed = useRef(false);

  const report = useCallback(
    (next: number) => {
      const zoomed = next > 1.01;
      if (zoomed === wasZoomed.current) return;
      wasZoomed.current = zoomed;
      onZoomChange(zoomed);
    },
    [onZoomChange]
  );

  // How far the image may travel before its edge crosses the screen's.
  const limit = useCallback(
    (ns: number) => ({ x: (width * (ns - 1)) / 2, y: (height * (ns - 1)) / 2 }),
    [width, height]
  );

  const apply = useCallback(
    (ns: number, nx: number, ny: number) => {
      s.current = ns;
      x.current = nx;
      y.current = ny;
      scale.setValue(ns);
      tx.setValue(nx);
      ty.setValue(ny);
      report(ns);
    },
    [scale, tx, ty, report]
  );

  const glideTo = useCallback(
    (ns: number, nx: number, ny: number) => {
      s.current = ns;
      x.current = nx;
      y.current = ny;
      report(ns);
      Animated.parallel([
        Animated.spring(scale, { toValue: ns, bounciness: 0, useNativeDriver: true }),
        Animated.spring(tx, { toValue: nx, bounciness: 0, useNativeDriver: true }),
        Animated.spring(ty, { toValue: ny, bounciness: 0, useNativeDriver: true }),
      ]).start();
    },
    [scale, tx, ty, report]
  );

  // Swiping to another photo leaves this one zoomed in; reset so coming back
  // starts fresh and the pager is scrollable again.
  useEffect(() => {
    if (!active) apply(1, 0, 0);
  }, [active, apply]);

  const pan = useRef(
    PanResponder.create({
      // Never claim the touch on contact: a plain tap has to reach the Pressable,
      // and a one-finger drag at 1x belongs to the pager underneath.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (e, g) =>
        e.nativeEvent.touches.length === 2 ||
        (s.current > 1.01 && (Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2)),

      onPanResponderGrant: () => {
        pinching.current = false;
        startS.current = s.current;
        startX.current = x.current;
        startY.current = y.current;
      },

      onPanResponderMove: (e, g) => {
        const touches = e.nativeEvent.touches as Touch[];

        if (touches.length === 2) {
          // Fresh pinch, or a pinch resumed after a finger was lifted.
          if (!pinching.current) {
            pinching.current = true;
            startS.current = s.current;
            startX.current = x.current;
            startY.current = y.current;
            startSpread.current = spread(touches);
            // The pager page is exactly the screen, so page coordinates minus
            // half the screen give the focal point relative to the centre.
            focal.current = {
              x: (touches[0].pageX + touches[1].pageX) / 2 - width / 2,
              y: (touches[0].pageY + touches[1].pageY) / 2 - height / 2,
            };
            return;
          }
          if (!startSpread.current) return;

          const ns = clamp(
            (startS.current * spread(touches)) / startSpread.current,
            1,
            MAX_SCALE
          );
          // Keep whatever sat under the fingers pinned there as it grows.
          const k = ns / startS.current;
          const b = limit(ns);
          apply(
            ns,
            clamp(focal.current.x - k * (focal.current.x - startX.current), -b.x, b.x),
            clamp(focal.current.y - k * (focal.current.y - startY.current), -b.y, b.y)
          );
          return;
        }

        if (s.current <= 1.01) return;

        // Entering the pan, either directly or as a pinch loses a finger.
        if (pinching.current) {
          pinching.current = false;
          startX.current = x.current;
          startY.current = y.current;
          panFrom.current = { dx: g.dx, dy: g.dy };
          return;
        }

        const b = limit(s.current);
        apply(
          s.current,
          clamp(startX.current + (g.dx - panFrom.current.dx), -b.x, b.x),
          clamp(startY.current + (g.dy - panFrom.current.dy), -b.y, b.y)
        );
      },

      onPanResponderEnd: () => {
        pinching.current = false;
        startSpread.current = 0;
        panFrom.current = { dx: 0, dy: 0 };
        // Pinching back below 1x should snap cleanly to fit, not sit slightly off.
        if (s.current <= 1.01) glideTo(1, 0, 0);
      },
    })
  ).current;

  const onTap = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (s.current > 1.01) glideTo(1, 0, 0);
      else glideTo(DOUBLE_TAP_SCALE, 0, 0);
      return;
    }
    lastTap.current = now;
  };

  return (
    <View style={{ width, height }} {...pan.panHandlers}>
      <Animated.View
        style={{
          flex: 1,
          // Translate before scale, so panning moves by screen pixels rather
          // than by pixels multiplied by the current zoom.
          transform: [{ translateX: tx }, { translateY: ty }, { scale }],
        }}>
        <Pressable onPress={onTap} style={{ flex: 1 }}>
          <RNImage source={{ uri }} style={{ flex: 1 }} resizeMode="contain" />
        </Pressable>
      </Animated.View>
    </View>
  );
}

/**
 * Full-screen photo viewer: swipe between the set, pinch or double-tap to zoom.
 * A 110px thumbnail cannot show a leaf spot; this is where the diagnosis happens.
 */
export function PhotoViewer({
  photos,
  initialIndex,
  onClose,
}: {
  photos: string[] | null;
  initialIndex: number;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  const landed = useRef(false);
  const [index, setIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);

  const open = !!photos && photos.length > 0;

  useEffect(() => {
    if (!open) return;
    landed.current = false;
    setIndex(initialIndex);
    setZoomed(false);
  }, [open, initialIndex, photos]);

  if (!open) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.back}>
        <ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          // While zoomed the drag belongs to the image, not to the pager.
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          // contentOffset is unreliable on Android, so jump once the pages exist.
          onContentSizeChange={() => {
            if (landed.current) return;
            landed.current = true;
            pager.current?.scrollTo({ x: initialIndex * width, animated: false });
          }}
          onMomentumScrollEnd={(e) => {
            // Read the offset now: the state update runs later, by which time
            // React Native has recycled the event and nativeEvent is null.
            setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
          }}>
          {photos.map((p, i) => (
            <ZoomableImage
              key={`${p}-${i}`}
              uri={p}
              width={width}
              height={height}
              active={i === index}
              onZoomChange={setZoomed}
            />
          ))}
        </ScrollView>

        <SafeAreaView style={styles.bar} edges={['top']} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={14} style={styles.pill}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
          {photos.length > 1 && (
            <View style={styles.pill}>
              <ThemedText type="small" style={styles.count}>
                {index + 1} / {photos.length}
              </ThemedText>
            </View>
          )}
        </SafeAreaView>

        {/* Said once, because pinching a photo is not obvious to everyone. */}
        {!zoomed && (
          <SafeAreaView style={styles.hintWrap} edges={['bottom']} pointerEvents="none">
            <View style={styles.pill}>
              <ThemedText type="small" style={styles.count}>
                Pinch or double-tap to zoom
              </ThemedText>
            </View>
          </SafeAreaView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: '#000' },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
  },
  hintWrap: {
    position: 'absolute',
    bottom: Spacing.four,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 4,
    borderRadius: Spacing.five,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  count: { color: '#fff', fontWeight: '700' },
});
