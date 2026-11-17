import { useEffect, useState } from 'react';

import { api } from '@/lib/api';

/**
 * The unread count behind every bell in the app.
 *
 * One number shared by all of them, so reading the list on the Notifications
 * screen clears the badge on every header at once.
 */
let unread = 0;
const listeners = new Set<(n: number) => void>();

export function setUnread(n: number) {
  unread = Math.max(0, n);
  listeners.forEach((f) => f(unread));
}

/** Ask the server how many are unread. Quiet on failure: the badge just stays. */
export async function refreshUnread(userId: string | undefined) {
  if (!userId) return;
  try {
    const r = await api.listNotifications(userId, 1);
    setUnread(r.unread);
  } catch {
    // offline or an older server: keep the last count
  }
}

export function useUnread() {
  const [n, setN] = useState(unread);
  useEffect(() => {
    listeners.add(setN);
    setN(unread);
    return () => {
      listeners.delete(setN);
    };
  }, []);
  return n;
}
