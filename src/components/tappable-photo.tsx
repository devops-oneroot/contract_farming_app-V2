import { Image, ImageContentFit, ImageStyle } from 'expo-image';
import { useMemo, useState } from 'react';
import { Pressable, StyleProp } from 'react-native';

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

  return (
    <>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        accessibilityRole="imagebutton"
        accessibilityLabel={caption ? `View ${caption}` : 'View photo'}>
        <Image source={{ uri }} style={style} contentFit={contentFit} />
      </Pressable>

      <PhotoViewer
        photos={open ? photos : null}
        initialIndex={index}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
