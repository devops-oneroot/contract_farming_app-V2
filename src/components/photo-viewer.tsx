import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image as RNImage,
  Modal,
  PanResponder,
  Pressable,
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
 * Full-screen photo viewer: pinch or double-tap to zoom, drag to pan, swipe
 * between photos.
 *
 * ONE PanResponder owns every gesture, and there is deliberately no ScrollView
 * anywhere in here. An earlier version put the images inside a horizontal
 * paging ScrollView and disabled its scrolling once zoomed — which could never
 * work: a pinch involves horizontal movement, so the native scroll view
 * intercepted the touch before this responder was ever asked, the zoom never
 * started, and the scroll view was therefore never disabled. Pinch was
 * unreachable by construction.
 *
 * Built on core React Native rather than gesture-handler because this ships
 * over the air, and a React Native Modal is its own native window where
 * gesture-handler needs a root view it does not have.
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
  const [index, setIndex] = useState(initialIndex);

  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  /**
   * Where the whole row of photos sits, in pixels: photo N is centred at
   * -N * width.
   *
   * The row is positioned ABSOLUTELY rather than relative to the current photo,
   * and this is the whole reason swiping works. The previous version translated
   * each photo by its distance from `index` and reset the drag to zero on
   * landing — but `setIndex` is a React render that happens later, while
   * `setValue` reaches the native transform immediately. For the frames in
   * between, a zeroed drag with the old index still rendered put the photo you
   * had just swiped away from straight back in the middle, so a successful
   * swipe looked like one the viewer had rejected.
   */
  const strip = useRef(new Animated.Value(-initialIndex * width)).current;

  // An Animated.Value cannot be read synchronously, and every gesture frame
  // needs the current transform, so it is mirrored in refs.
  const s = useRef(1);
  const x = useRef(0);
  const y = useRef(0);
  const idx = useRef(initialIndex);

  const startS = useRef(1);
  const startX = useRef(0);
  const startY = useRef(0);
  const startSpread = useRef(0);
  const focal = useRef({ x: 0, y: 0 });
  const mode = useRef<'none' | 'pinch' | 'pan' | 'swipe'>('none');
  /** Where the finger was when panning took over, so a lifted finger jumps. */
  const panFrom = useRef({ dx: 0, dy: 0 });
  const lastTap = useRef(0);
  /** Read inside the responder, which is built once and never sees new props. */
  const size = useRef({ width, height });
  const total = useRef(photos?.length ?? 0);

  const open = !!photos && photos.length > 0;
  const count = photos?.length ?? 0;
  size.current = { width, height };
  total.current = count;

  const apply = (ns: number, nx: number, ny: number) => {
    s.current = ns;
    x.current = nx;
    y.current = ny;
    scale.setValue(ns);
    tx.setValue(nx);
    ty.setValue(ny);
  };

  const glideTo = (ns: number, nx: number, ny: number) => {
    s.current = ns;
    x.current = nx;
    y.current = ny;
    Animated.parallel([
      Animated.spring(scale, { toValue: ns, bounciness: 0, useNativeDriver: true }),
      Animated.spring(tx, { toValue: nx, bounciness: 0, useNativeDriver: true }),
      Animated.spring(ty, { toValue: ny, bounciness: 0, useNativeDriver: true }),
    ]).start();
  };

  /** How far the image may travel before its edge crosses the screen's. */
  const limit = (ns: number) => ({
    x: (size.current.width * (ns - 1)) / 2,
    y: (size.current.height * (ns - 1)) / 2,
  });

  useEffect(() => {
    if (!open) return;
    idx.current = initialIndex;
    setIndex(initialIndex);
    apply(1, 0, 0);
    strip.setValue(-initialIndex * width);
    // Re-armed on each open, and on rotation: the row is measured in pixels, so
    // a new screen width leaves it parked between two photos otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialIndex, photos, width]);

  const pan = useRef(
    PanResponder.create({
      // Never claim the touch on contact: a plain tap has to reach the
      // Pressable underneath for double-tap to work.
      onStartShouldSetPanResponder: () => false,
      /**
       * Claimed in the CAPTURE phase, which is what makes a drag reliable.
       *
       * The tap lands on the Pressable around the image, so by the time a
       * finger moves, that Pressable already owns the touch. Asking on the way
       * back up depends on React Native offering the gesture to an ancestor of
       * the current responder — it usually does, but capture does not depend on
       * it at all: this view is asked first, before the Pressable is consulted.
       * Only movement is captured, so an ordinary tap still reaches through.
       */
      onMoveShouldSetPanResponderCapture: (e, g) =>
        e.nativeEvent.touches.length === 2 || Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      // Nothing above this may take the gesture away mid-pinch.
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: () => {
        mode.current = 'none';
        startS.current = s.current;
        startX.current = x.current;
        startY.current = y.current;
      },

      onPanResponderMove: (e, g) => {
        const touches = e.nativeEvent.touches as Touch[];
        const w = size.current.width;

        if (touches.length === 2) {
          // Fresh pinch, or one resumed after a finger was lifted and replaced.
          if (mode.current !== 'pinch') {
            mode.current = 'pinch';
            startS.current = s.current;
            startX.current = x.current;
            startY.current = y.current;
            startSpread.current = spread(touches);
            // The image fills the screen, so page coordinates minus half the
            // screen give the focal point relative to its centre.
            focal.current = {
              x: (touches[0].pageX + touches[1].pageX) / 2 - w / 2,
              y: (touches[0].pageY + touches[1].pageY) / 2 - size.current.height / 2,
            };
            return;
          }
          if (!startSpread.current) return;

          const ns = clamp((startS.current * spread(touches)) / startSpread.current, 1, MAX_SCALE);
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

        // Zoomed in: one finger drags the image.
        if (s.current > 1.01) {
          if (mode.current !== 'pan') {
            mode.current = 'pan';
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
          return;
        }

        // Not zoomed: one finger drags the whole row sideways.
        if (total.current > 1) {
          mode.current = 'swipe';
          strip.setValue(-idx.current * w + g.dx);
        }
      },

      /**
       * Release, not end: `onPanResponderEnd` fires when ANY finger lifts, so
       * letting go of one half of a pinch would be read as the gesture
       * finishing while the other finger was still on the glass.
       */
      onPanResponderRelease: (e, g) => {
        const was = mode.current;
        mode.current = 'none';
        startSpread.current = 0;
        panFrom.current = { dx: 0, dy: 0 };

        if (was === 'pinch' && s.current <= 1.01) {
          // Pinching back below 1x snaps cleanly to fit, not slightly off.
          glideTo(1, 0, 0);
          return;
        }
        if (was !== 'swipe') return;

        const w = size.current.width;
        // A quarter of the screen, or a flick, turns the page.
        const far = Math.abs(g.dx) > w / 4 || Math.abs(g.vx) > 0.5;
        const wanted = idx.current + (g.dx < 0 ? 1 : -1);
        const next = far && wanted >= 0 && wanted < total.current ? wanted : idx.current;

        idx.current = next;
        Animated.spring(strip, {
          toValue: -next * w,
          bounciness: 0,
          useNativeDriver: true,
        }).start();
        // Safe to re-render immediately: every photo is parked at its own fixed
        // place in the row, so nothing moves because `index` changed. It only
        // decides which photo carries the zoom and what the counter reads.
        setIndex(next);
        apply(1, 0, 0);
      },

      // A gesture taken away by the system leaves the row parked between two
      // photos, so it is put back where it belongs.
      onPanResponderTerminate: () => {
        mode.current = 'none';
        startSpread.current = 0;
        Animated.spring(strip, {
          toValue: -idx.current * size.current.width,
          bounciness: 0,
          useNativeDriver: true,
        }).start();
      },
    })
  ).current;

  const onTap = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      glideTo(s.current > 1.01 ? 1 : DOUBLE_TAP_SCALE, 0, 0);
      return;
    }
    lastTap.current = now;
  };

  if (!open) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.back} {...pan.panHandlers}>
        {/*
          One row holding every photo, each at its own fixed offset, moved as a
          whole. Only the current photo carries the zoom transform — the others
          are always at 1x, so arriving at a neighbour never shows someone
          else's zoom.
        */}
        <Animated.View
          style={[
            styles.strip,
            { width: width * count, transform: [{ translateX: strip }] },
          ]}>
          {photos!.map((p, i) => {
            // Two neighbours is all a swipe can reveal; the rest stay unmounted.
            if (Math.abs(i - index) > 1) return null;
            const isCurrent = i === index;
            return (
              <Animated.View
                key={`${p}-${i}`}
                style={[
                  styles.page,
                  {
                    left: i * width,
                    width,
                    height,
                    // Translate before scale, so panning moves by screen pixels
                    // rather than pixels multiplied by the current zoom.
                    transform: isCurrent
                      ? [{ translateX: tx }, { translateY: ty }, { scale }]
                      : [],
                  },
                ]}>
                <Pressable onPress={onTap} style={{ flex: 1 }}>
                  <RNImage source={{ uri: p }} style={{ flex: 1 }} resizeMode="contain" />
                </Pressable>
              </Animated.View>
            );
          })}
        </Animated.View>

        <SafeAreaView style={styles.bar} edges={['top']} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={14} style={styles.pill}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
          {count > 1 && (
            <View style={styles.pill}>
              <ThemedText type="small" style={styles.count}>
                {index + 1} / {count}
              </ThemedText>
            </View>
          )}
        </SafeAreaView>

        {/* Said once, because neither gesture is obvious to everyone. */}
        <SafeAreaView style={styles.hintWrap} edges={['bottom']} pointerEvents="none">
          <View style={styles.pill}>
            <ThemedText type="small" style={styles.count}>
              {count > 1 ? 'Swipe for the next photo · pinch to zoom' : 'Pinch or double-tap to zoom'}
            </ThemedText>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  strip: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  page: { position: 'absolute', top: 0 },
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
