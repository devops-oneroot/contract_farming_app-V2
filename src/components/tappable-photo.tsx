import { Image, ImageContentFit, ImageStyle } from 'expo-image';
import { useMemo, useState } from 'react';
import { Pressable, StyleProp, StyleSheet } from 'react-native';

import { PhotoViewer } from '@/components/photo-viewer';

/**
 * A photo that opens full screen, pinchable, when tapped.
 *
 * Wraps the viewer rather than repeating it: every proof photo in the app
 * behaves the same way, and a farmer looking at a leaf spot should never have
 * to wonder whether this particular thumbnail is the one that zooms.
 *
 * The viewer only mounts once opened, so an unopened photo costs nothing
 * beyond the image itself.
 */
export function TappablePhoto({
  uri,
  group,
  index = 0,
  caption,
  style,
  contentFit = 'cover',
  disabled,
}: {
  uri: string;
  /**
   * The set this photo belongs to, so the viewer can swipe between them.
   * Defaults to the photo alone.
   */
  group?: string[];
  index?: number;
  /** Unused by the viewer today; kept so callers can describe a photo. */
  caption?: string;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  /**
   * Held steady across renders, by content rather than by identity.
   *
   * Callers pass groups built inline — `[before, after].filter(Boolean)` — so
   * the array is a new object every render even when the photos are the same.
   * The viewer treats a new set as a new set and returns to the photo it was
   * opened on, which would throw away a swipe the moment anything on the screen
   * behind it re-rendered.
   */
  const key = group?.length ? group.join('|') : uri;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const photos = useMemo(() => (group?.length ? group : [uri]), [key]);

  /**
   * The size goes on the Pressable as well as the image.
   *
   * Without it a photo styled `width: '100%'` vanishes: the wrapper shrinks to
   * fit its content, while the content's width is a percentage OF the wrapper —
   * so it resolves to nothing and the image is never drawn. Callers used to
   * style a bare `<Image>`, where the parent supplied that width directly, and
   * wrapping them in this component quietly broke every one of them that sized
   * itself in percentages.
   *
   * Only the box matters here. Anything about how the image is painted —
   * corners, background, fit — stays on the image itself.
   */
  const box = StyleSheet.flatten(style) as ImageStyle | undefined;

  return (
    <>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        accessibilityRole="imagebutton"
        accessibilityLabel={caption ? `View ${caption}` : 'View photo'}
        style={{
          width: box?.width,
          height: box?.height,
          flex: box?.flex,
          alignSelf: box?.alignSelf,
        }}>
        <Image source={{ uri }} style={[style, styles.fill]} contentFit={contentFit} />
      </Pressable>

      <PhotoViewer
        photos={open ? photos : null}
        initialIndex={index}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  // The image fills the box the Pressable now holds, so a percentage width has
  // a real parent to be a percentage of.
  fill: { width: '100%', height: '100%' },
});
