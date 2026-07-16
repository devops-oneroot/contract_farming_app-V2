import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePostHog } from 'posthog-react-native';
import { createContext, useContext, useEffect, useState } from 'react';

import { User } from '@/lib/api';

const STORAGE_KEY = 'oneroot.user';
const ONBOARD_KEY = 'oneroot.onboarded';

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  onboarded: boolean;
  completeOnboarding: () => Promise<void>;
  signIn: (user: User) => Promise<void>;
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
        const [raw, ob] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(ONBOARD_KEY),
        ]);
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

  const signIn = async (u: User) => {
    setUser(u);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(u));
  };

  const signOut = async () => {
    posthog?.reset();
    setUser(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, loading, onboarded, completeOnboarding, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
