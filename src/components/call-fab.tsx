import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Linking, Platform, Pressable, StyleSheet } from 'react-native';

import { Spacing } from '@/constants/theme';

// Support / contact number for the contract-farming team.
const SUPPORT_NUMBER = '9606031878';

// Floating support button. It bounces up-and-down on mount (and every few
// seconds) so farmers notice it's their helpline. Tapping dials support.
export function CallFab() {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const up = (d: number) => Animated.timing(anim, { toValue: 1, duration: d, useNativeDriver: true });
    const down = (d: number) => Animated.timing(anim, { toValue: 0, duration: d, useNativeDriver: true });
    // three quick bounces
    const burst = () => Animated.sequence([up(180), down(180), up(180), down(180), up(180), down(220)]).start();

    burst(); // attention on first open
    const id = setInterval(burst, 6000); // gentle reminder every 6s
    return () => clearInterval(id);
  }, [anim]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });

  const call = () => {
    Linking.openURL(`tel:${SUPPORT_NUMBER}`).catch(() => {});
  };

  return (
    <Animated.View style={[styles.wrap, { transform: [{ translateY }] }]}>
      <Pressable
        onPress={call}
        accessibilityRole="button"
        accessibilityLabel={`Call helpline ${SUPPORT_NUMBER}`}
        style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.94 }] }]}>
        <MaterialIcons name="support-agent" size={30} color="#fff" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: Spacing.four,
    // The tab bar is docked, so the screen already ends above it - a plain gap
    // clears it on every platform. (BottomTabInset is 0 on web, which put the
    // button half behind the bar there.)
    bottom: Spacing.four,
  },
  fab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FF7F00',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      android: { elevation: 8 },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
    }),
  },
});
