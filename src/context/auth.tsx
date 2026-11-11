import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePostHog } from 'posthog-react-native';
import { createContext, useContext, useEffect, useRef, useState } from 'react';

import { AuthResponse, setAuthToken, setUnauthorizedHandler, User } from '@/lib/api';
import { detachTracking } from '@/lib/tracking';

const STORAGE_KEY = 'oneroot.user';
const TOKEN_KEY = 'oneroot.token';
const ONBOARD_KEY = 'oneroot.onboarded';

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  onboarded: boolean;
  completeOnboarding: () => Promise<void>;
  /** Sign in with what /login or /onboard returned (the user plus their token). */
  signIn: (res: AuthResponse) => Promise<void>;
  /** Replace the stored user after an edit (profile, farm boundary). Keeps the session. */
  updateUser: (user: User) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const posthog = usePostHog();
  const [user, setUser] = useState<User | null>(null);
  const [onboarded, setOnboarded] = useState(false);
  const [loading, setLoading] = useState(true);

  // Tie analytics events to the signed-in user (farmer / agronomist).
  useEffect(() => {
    if (user?._id) {
      posthog?.identify(user._id, { name: user.name, mobile: user.mobile, role: user.role });
    }
  }, [user?._id, posthog]);

  useEffect(() => {
    (async () => {
      try {
        const [raw, token, ob] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(ONBOARD_KEY),
        ]);
        // Before the user, so the first screen's requests already carry it.
        // Someone signed in on an app version from before tokens has none; they
        // stay signed in until the server starts requiring one.
        setAuthToken(token);
        if (raw) setUser(JSON.parse(raw));
        setOnboarded(ob === '1');
      } catch {
        // ignore corrupt storage
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const completeOnboarding = async () => {
    setOnboarded(true);
    await AsyncStorage.setItem(ONBOARD_KEY, '1');
  };

  const signIn = async ({ token, ...u }: AuthResponse) => {
    setAuthToken(token);
    setUser(u);
    // The token is stored apart from the user, so it never ends up in analytics
    // or anywhere else the user object is passed around.
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(u)),
      AsyncStorage.setItem(TOKEN_KEY, token),
    ]);
  };

  const updateUser = async (u: User) => {
    // Drop a `token` field if an edit endpoint ever echoes one back.
    const { token: _drop, ...clean } = u as User & { token?: string };
    setUser(clean);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  };

  const signOut = async () => {
    // Analytics must never be the reason someone cannot sign out.
    try {
      posthog?.reset();
    } catch {}
    // Capped: with no signal, sending the last buffered points could hang, and
    // the agent must still get to the login screen.
    await Promise.race([detachTracking().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    await AsyncStorage.multiRemove([STORAGE_KEY, TOKEN_KEY]).catch(() => {});
    setAuthToken(null);
    // Last: this is what sends the app to the login screen.
    setUser(null);
  };

  // A token the server rejects (expired, revoked) signs the user out. Through a
  // ref so the handler always calls the current signOut.
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  useEffect(() => {
    setUnauthorizedHandler(() => {
      signOutRef.current();
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, onboarded, completeOnboarding, signIn, updateUser, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
