import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import { upsertUserProfile } from '../lib/firestoreRepo';

interface AuthContextValue {
  user: User | null;
  idToken: string | null;
  loading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  getFreshToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        try {
          const token = await nextUser.getIdToken();
          setIdToken(token);
          if (nextUser.email) {
            await upsertUserProfile(
              nextUser.uid,
              nextUser.email,
              nextUser.displayName || nextUser.email.split('@')[0]
            );
          }
        } catch (err) {
          console.error('Auth initialization error:', err);
        }
      } else {
        setIdToken(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const token = await cred.user.getIdToken();
      setIdToken(token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed.';
      setAuthError(msg);
      throw err;
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setAuthError(null);
    await signOut(auth);
    setIdToken(null);
  }, []);

  const getFreshToken = useCallback(async (): Promise<string | null> => {
    if (!auth.currentUser) return null;
    const token = await auth.currentUser.getIdToken();
    setIdToken(token);
    return token;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        idToken,
        loading,
        authError,
        signInWithGoogle,
        signOutUser,
        getFreshToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
