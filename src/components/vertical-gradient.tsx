import { useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

type RGBA = [number, number, number, number];

/** `stops`: [position 0..1, rgba] pairs, top to bottom. */
type Stops = [number, RGBA][];

function colourAt(stops: Stops, t: number): RGBA {
  for (let i = 1; i < stops.length; i += 1) {
    const [p0, c0] = stops[i - 1];
    const [p1, c1] = stops[i];
    if (t <= p1) {
      const k = p1 === p0 ? 0 : (t - p0) / (p1 - p0);
      return c0.map((v, j) => v + (c1[j] - v) * k) as RGBA;
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * A top-to-bottom gradient made of thin bands of colour.
 *
 * Plain Views on purpose: a gradient library is a native module, and adding one
 * means a new store build; this ships over the air and draws the same on
 * Android, iOS and web. At 32 bands the steps are invisible on a phone.
 *
 * Bands are placed on whole pixels from the measured height, edge to edge:
 * overlapping see-through bands would double up and draw dark stripes, and
 * percentage edges leave hairline gaps.
 */
export function VerticalGradient({
  stops,
  bands = 32,
  style,
}: {
  stops: Stops;
  bands?: number;
  style?: ViewStyle;
}) {
  const [height, setHeight] = useState(0);
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, style]}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      {height > 0 &&
        Array.from({ length: bands }, (_, i) => {
          const [r, g, b, a] = colourAt(stops, (i + 0.5) / bands);
          const top = Math.round((i * height) / bands);
          const bottom = Math.round(((i + 1) * height) / bands);
          return (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top,
                height: bottom - top,
                backgroundColor: `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a.toFixed(3)})`,
              }}
            />
          );
        })}
    </View>
  );
}
