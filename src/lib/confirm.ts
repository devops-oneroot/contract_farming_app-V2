import { Alert, Platform } from 'react-native';

/**
 * "Are you sure?" that works everywhere.
 *
 * react-native-web's Alert.alert is an empty function: on web a confirm dialog
 * built with it never appears, so the button behind it silently does nothing
 * (this is what broke Log Out). On web this uses the browser's own confirm
 * dialog; on a phone, the native Alert with Cancel / confirm buttons.
 */
export function confirmAction({
  title,
  message,
  confirmText,
  destructive = false,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmText: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}
