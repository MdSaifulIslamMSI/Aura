import { createContext, useState, useEffect, useRef } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  signInWithPopup
} from 'firebase/auth';
import {
  auth,
  googleProvider,
  facebookProvider,
  xProvider,
  assertFirebaseReady,
  assertFirebaseSocialAuthReady,
  isFirebaseReady,
} from '../config/firebase';
import { userApi } from '../services/api';

export const AuthContext = createContext();

const AUTH_SYNC_DEDUPE_MS = 30 * 1000;

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [dbUser, setDbUser] = useState(null); // MongoDB user record
  const [loading, setLoading] = useState(true);
  const syncStateRef = useRef({
    identity: '',
    lastSyncedAt: 0,
    inFlight: null,
  });
  const dbUserRef = useRef(null);

  useEffect(() => {
    dbUserRef.current = dbUser;
  }, [dbUser]);

  /**
   * Sync Firebase user → MongoDB.
   * Creates the user if they don't exist (upsert).
   * Returns the MongoDB user record.
   */
  const syncUserWithBackend = async (email, name, phone, firebaseUser = null, options = {}) => {
    const force = options?.force === true;
    const safeEmail = (email || '').trim().toLowerCase();
    const safeName = (name || '').trim() || (safeEmail ? safeEmail.split('@')[0] : '');
    const safePhone = (phone || '').trim();
    const uid = firebaseUser?.uid || auth.currentUser?.uid || '';
    const identity = `${uid || 'nouid'}::${safeEmail || 'noemail'}`;

    if (!safeEmail) return null;

    const now = Date.now();
    const shouldShortCircuit = !force
      && syncStateRef.current.identity === identity
      && dbUserRef.current
      && (now - syncStateRef.current.lastSyncedAt) < AUTH_SYNC_DEDUPE_MS;

    if (shouldShortCircuit) {
      return dbUserRef.current;
    }

    if (!force && syncStateRef.current.identity === identity && syncStateRef.current.inFlight) {
      return syncStateRef.current.inFlight;
    }

    const runSync = async () => {
      try {
        const mongoUser = await userApi.login(safeEmail, safeName, safePhone, { firebaseUser });
        setDbUser(mongoUser);
        syncStateRef.current = {
          ...syncStateRef.current,
          identity,
          lastSyncedAt: Date.now(),
        };
        return mongoUser;
      } catch (error) {
        console.error('Backend sync failed:', error.message);
        // Recovery path: attempt profile fetch (backend can auto-bootstrap on protect/profile route).
        try {
          const profile = await userApi.getProfile('', { firebaseUser });
          setDbUser(profile);
          syncStateRef.current = {
            ...syncStateRef.current,
            identity,
            lastSyncedAt: Date.now(),
          };
          return profile;
        } catch (profileError) {
          console.error('Profile recovery failed:', profileError.message);
          // Final fallback identity must never preserve stale privilege flags from
          // a previous session. Keep only minimal identity fields and fail closed.
          setDbUser({
            name: safeName || safeEmail.split('@')[0] || 'Aura User',
            email: safeEmail,
            phone: safePhone,
            isAdmin: false,
            isSeller: false,
            isVerified: Boolean(firebaseUser?.emailVerified),
          });
          return null;
        }
      }
    };

    const inFlight = runSync().finally(() => {
      if (syncStateRef.current.identity === identity) {
        syncStateRef.current = {
          ...syncStateRef.current,
          inFlight: null,
        };
      }
    });

    syncStateRef.current = {
      ...syncStateRef.current,
      identity,
      inFlight,
    };

    return inFlight;
  };

  // Sign up with phone number
  const signup = async (email, password, name, phone) => {
    assertFirebaseReady('Sign up');
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(userCredential.user, { displayName: name });
    setCurrentUser({ ...userCredential.user, displayName: name });
    // Sync with MongoDB — pass phone
    await syncUserWithBackend(email, name, phone, null, { force: true });
    return userCredential;
  };

  // Login
  const login = async (email, password) => {
    assertFirebaseReady('Sign in');
    const result = await signInWithEmailAndPassword(auth, email, password);
    // Backend sync happens via onAuthStateChanged
    return result;
  };

  // Google Sign-In
  // Returns { firebaseUser, dbUser, isNewUser, needsPhone }
  const signInWithOAuthProvider = async (provider, providerLabel = 'OAuth') => {
    assertFirebaseSocialAuthReady(`${providerLabel} sign-in`);
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    const isNewUser = result._tokenResponse?.isNewUser || false;
    const email = user.email || user.providerData?.find((entry) => entry?.email)?.email || '';

    if (!email) {
      throw new Error(`${providerLabel} account did not provide an email. Please use an account with email access or use another login method.`);
    }

    // Sync with backend immediately (don't wait for onAuthStateChanged)
    const mongoUser = await syncUserWithBackend(
      email,
      user.displayName || email.split('@')[0],
      user.phoneNumber || '', // Google may provide phone
      user,
      { force: true }
    );

    return {
      firebaseUser: user,
      dbUser: mongoUser,
      isNewUser,
      needsPhone: !mongoUser?.phone // Flag if phone is missing
    };
  };

  const signInWithGoogle = async () => signInWithOAuthProvider(googleProvider, 'Google');
  const signInWithFacebook = async () => signInWithOAuthProvider(facebookProvider, 'Facebook');
  const signInWithX = async () => signInWithOAuthProvider(xProvider, 'X');

  // Logout
  const logout = () => {
    if (!isFirebaseReady || !auth) {
      setDbUser(null);
      syncStateRef.current = {
        identity: '',
        lastSyncedAt: 0,
        inFlight: null,
      };
      setCurrentUser(null);
      return Promise.resolve();
    }
    setDbUser(null);
    syncStateRef.current = {
      identity: '',
      lastSyncedAt: 0,
      inFlight: null,
    };
    return signOut(auth);
  };

  // Forgot Password
  const forgotPassword = (email) => {
    assertFirebaseReady('Password reset');
    return sendPasswordResetEmail(auth, email);
  };

  // Update phone in backend
  const updatePhone = async (phone) => {
    if (!currentUser?.email) return;
    try {
      const updated = await userApi.login(currentUser.email, currentUser.displayName, phone, { firebaseUser: currentUser });
      setDbUser(updated);
      syncStateRef.current = {
        ...syncStateRef.current,
        identity: `${currentUser?.uid || 'nouid'}::${(currentUser?.email || '').trim().toLowerCase()}`,
        lastSyncedAt: Date.now(),
      };
      return updated;
    } catch (error) {
      console.error('Phone update failed:', error.message);
      throw error;
    }
  };

  useEffect(() => {
    let isMounted = true;

    // Prevent full-app blank screen if auth/bootstrap stalls.
    const bootstrapTimeout = setTimeout(() => {
      if (isMounted) {
        setLoading(false);
      }
    }, 4000);

    if (!isFirebaseReady || !auth) {
      setCurrentUser(null);
      setDbUser(null);
      setLoading(false);
      return () => {
        isMounted = false;
        clearTimeout(bootstrapTimeout);
      };
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!isMounted) return;

      setCurrentUser(user);
      setLoading(false);

      if (user) {
        const normalizedEmail = (user.email || '').trim().toLowerCase();
        const currentDbEmail = (dbUserRef.current?.email || '').trim().toLowerCase();

        if (!normalizedEmail || currentDbEmail !== normalizedEmail) {
          setDbUser(null);
        }

        // Run backend sync in background so UI does not block on network.
        syncUserWithBackend(
          user.email,
          user.displayName || user.email?.split('@')[0],
          user.phoneNumber || '',
          user
        ).catch((error) => {
          console.error('Auth background sync failed:', error?.message || error);
        });
      } else {
        setDbUser(null);
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(bootstrapTimeout);
      unsubscribe();
    };
  }, []);

  // Update profile fields in backend and sync dbUser
  const updateProfile = async (data) => {
    try {
      const updated = await userApi.updateProfile(data);
      setDbUser(prev => ({ ...prev, ...updated }));
      return updated;
    } catch (error) {
      console.error('Profile update failed:', error.message);
      throw error;
    }
  };

  const activateSeller = async () => {
    try {
      const response = await userApi.activateSeller();
      const sellerUser = response?.user || null;
      if (sellerUser) {
        setDbUser((prev) => ({ ...(prev || {}), ...sellerUser }));
      }
      return response;
    } catch (error) {
      console.error('Seller activation failed:', error.message);
      throw error;
    }
  };

  const deactivateSeller = async () => {
    try {
      const response = await userApi.deactivateSeller();
      const sellerUser = response?.user || null;
      if (sellerUser) {
        setDbUser((prev) => ({ ...(prev || {}), ...sellerUser }));
      }
      return response;
    } catch (error) {
      console.error('Seller deactivation failed:', error.message);
      throw error;
    }
  };

  const value = {
    currentUser,
    dbUser,
    isAuthenticated: !!currentUser,
    signup,
    login,
    signInWithGoogle,
    signInWithFacebook,
    signInWithX,
    logout,
    forgotPassword,
    syncUserWithBackend,
    updatePhone,
    updateProfile,
    activateSeller,
    deactivateSeller,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
