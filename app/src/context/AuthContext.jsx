import { createContext, useEffect, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile as updateFirebaseProfile,
  sendPasswordResetEmail,
  signInWithPopup,
} from 'firebase/auth';
import {
  auth,
  googleProvider,
  facebookProvider,
  xProvider,
  assertFirebaseReady,
  assertFirebaseSocialAuthReady,
  isFirebaseReady,
  markFirebaseSocialAuthRejectedForRuntime,
} from '../config/firebase';
import { authApi, userApi } from '../services/api';

export const AuthContext = createContext();

const AUTH_SYNC_DEDUPE_MS = 30 * 1000;
const BOOTSTRAP_TIMEOUT_MS = 6000;

const SESSION_STATUS = {
  BOOTSTRAP: 'bootstrap',
  LOADING: 'loading',
  AUTHENTICATED: 'authenticated',
  RECOVERABLE_ERROR: 'recoverable_error',
  SIGNED_OUT: 'signed_out',
};

const EMPTY_ROLES = {
  isAdmin: false,
  isSeller: false,
  isVerified: false,
};

const EMPTY_SESSION_STATE = {
  status: SESSION_STATUS.BOOTSTRAP,
  session: null,
  profile: null,
  roles: EMPTY_ROLES,
  error: null,
};

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const normalizePhone = (value) => (
  typeof value === 'string' ? value.trim().replace(/[\s\-()]/g, '') : ''
);

const buildRoleState = (profile = null, fallbackVerified = false) => ({
  isAdmin: Boolean(profile?.isAdmin),
  isSeller: Boolean(profile?.isSeller),
  isVerified: Boolean(profile?.isVerified ?? fallbackVerified),
});

const buildFirebaseSessionFallback = (firebaseUser = null) => {
  if (!firebaseUser) return null;

  const providerIds = Array.isArray(firebaseUser.providerData)
    ? firebaseUser.providerData.map((entry) => normalizeText(entry?.providerId)).filter(Boolean)
    : [];

  return {
    uid: normalizeText(firebaseUser.uid),
    email: normalizeEmail(firebaseUser.email),
    emailVerified: Boolean(firebaseUser.emailVerified),
    displayName: normalizeText(firebaseUser.displayName),
    phone: normalizePhone(firebaseUser.phoneNumber),
    providerIds,
    authTime: null,
    issuedAt: null,
    expiresAt: null,
  };
};

const buildSessionStateFromPayload = (payload = {}, firebaseUser = null) => {
  const session = payload?.session || buildFirebaseSessionFallback(firebaseUser);
  const profile = payload?.profile || null;
  const roles = payload?.roles || buildRoleState(profile, session?.emailVerified);

  return {
    status: payload?.status || (session ? SESSION_STATUS.AUTHENTICATED : SESSION_STATUS.SIGNED_OUT),
    session,
    profile,
    roles,
    error: payload?.error || null,
  };
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [sessionState, setSessionState] = useState(EMPTY_SESSION_STATE);
  const syncStateRef = useRef({
    identity: '',
    lastSyncedAt: 0,
    inFlight: null,
  });
  const sessionStateRef = useRef(EMPTY_SESSION_STATE);

  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  const resetSyncTracking = () => {
    syncStateRef.current = {
      identity: '',
      lastSyncedAt: 0,
      inFlight: null,
    };
  };

  const applySignedOutState = () => {
    resetSyncTracking();
    setSessionState({
      status: SESSION_STATUS.SIGNED_OUT,
      session: null,
      profile: null,
      roles: EMPTY_ROLES,
      error: null,
    });
  };

  const applyResolvedSession = (payload, firebaseUser, identity) => {
    setSessionState(buildSessionStateFromPayload(payload, firebaseUser));
    syncStateRef.current = {
      identity,
      lastSyncedAt: Date.now(),
      inFlight: null,
    };
    return payload?.profile || null;
  };

  const applyRecoverableSessionError = (error, firebaseUser, identity) => {
    setSessionState({
      status: SESSION_STATUS.RECOVERABLE_ERROR,
      session: buildFirebaseSessionFallback(firebaseUser),
      profile: null,
      roles: EMPTY_ROLES,
      error: {
        message: error?.message || 'Unable to resolve account session right now.',
      },
    });
    syncStateRef.current = {
      identity,
      lastSyncedAt: 0,
      inFlight: null,
    };
  };

  const getIdentityKey = (firebaseUser, email = '') => {
    const uid = normalizeText(firebaseUser?.uid || auth?.currentUser?.uid);
    const safeEmail = normalizeEmail(email || firebaseUser?.email || auth?.currentUser?.email);
    return `${uid || 'nouid'}::${safeEmail || 'noemail'}`;
  };

  const shouldReuseResolvedSession = (identity, force) => {
    const state = sessionStateRef.current;
    return !force
      && identity
      && syncStateRef.current.identity === identity
      && state.status === SESSION_STATUS.AUTHENTICATED
      && state.profile
      && (Date.now() - syncStateRef.current.lastSyncedAt) < AUTH_SYNC_DEDUPE_MS;
  };

  const runSessionRequest = async ({
    mode = 'session',
    firebaseUser = null,
    email = '',
    name = '',
    phone = '',
    force = false,
    silent = false,
  } = {}) => {
    const activeUser = firebaseUser || auth?.currentUser || null;
    const safeEmail = normalizeEmail(email || activeUser?.email);

    if (!activeUser || !safeEmail) {
      applySignedOutState();
      return null;
    }

    const identity = getIdentityKey(activeUser, safeEmail);

    if (shouldReuseResolvedSession(identity, force)) {
      return sessionStateRef.current.profile;
    }

    if (!force && syncStateRef.current.identity === identity && syncStateRef.current.inFlight) {
      return syncStateRef.current.inFlight;
    }

    if (!silent) {
      setSessionState((prev) => ({
        status: prev.status === SESSION_STATUS.BOOTSTRAP ? SESSION_STATUS.BOOTSTRAP : SESSION_STATUS.LOADING,
        session: prev.session || buildFirebaseSessionFallback(activeUser),
        profile: null,
        roles: EMPTY_ROLES,
        error: null,
      }));
    }

    const requestPromise = (async () => {
      const payload = mode === 'sync'
        ? await authApi.syncSession(safeEmail, name, phone, { firebaseUser: activeUser })
        : await authApi.getSession({ firebaseUser: activeUser });
      return applyResolvedSession(payload, activeUser, identity);
    })()
      .catch((error) => {
        applyRecoverableSessionError(error, activeUser, identity);
        throw error;
      })
      .finally(() => {
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
      inFlight: requestPromise,
    };

    return requestPromise;
  };

  const refreshSession = async (firebaseUser = null, options = {}) => runSessionRequest({
    mode: 'session',
    firebaseUser,
    force: options?.force === true,
    silent: options?.silent === true,
  });

  const syncUserWithBackend = async (email, name, phone, firebaseUser = null, options = {}) => runSessionRequest({
    mode: 'sync',
    firebaseUser,
    email,
    name,
    phone,
    force: options?.force === true,
    silent: options?.silent === true,
  });

  const signup = async (email, password, name, phone) => {
    assertFirebaseReady('Sign up');
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    await updateFirebaseProfile(userCredential.user, { displayName: name });
    await syncUserWithBackend(email, name, phone, userCredential.user, { force: true });
    return userCredential;
  };

  const login = async (email, password) => {
    assertFirebaseReady('Sign in');
    const result = await signInWithEmailAndPassword(auth, email, password);
    await refreshSession(result.user, { force: true });
    return result;
  };

  const signInWithOAuthProvider = async (provider, providerLabel = 'OAuth') => {
    try {
      assertFirebaseSocialAuthReady(`${providerLabel} sign-in`);
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      const isNewUser = result._tokenResponse?.isNewUser || false;
      const email = user.email || user.providerData?.find((entry) => entry?.email)?.email || '';

      if (!email) {
        throw new Error(`${providerLabel} account did not provide an email. Please use an account with email access or use another login method.`);
      }

      const resolvedProfile = await syncUserWithBackend(
        email,
        user.displayName || email.split('@')[0],
        user.phoneNumber || '',
        user,
        { force: true }
      );

      return {
        firebaseUser: user,
        dbUser: resolvedProfile,
        isNewUser,
        needsPhone: !resolvedProfile?.phone,
      };
    } catch (error) {
      markFirebaseSocialAuthRejectedForRuntime(error);
      throw error;
    }
  };

  const signInWithGoogle = async () => signInWithOAuthProvider(googleProvider, 'Google');
  const signInWithFacebook = async () => signInWithOAuthProvider(facebookProvider, 'Facebook');
  const signInWithX = async () => signInWithOAuthProvider(xProvider, 'X');

  const logout = async () => {
    setCurrentUser(null);
    applySignedOutState();

    if (!isFirebaseReady || !auth) {
      return;
    }

    await signOut(auth);
  };

  const forgotPassword = (email) => {
    assertFirebaseReady('Password reset');
    return sendPasswordResetEmail(auth, email);
  };

  const updatePhone = async (phone) => {
    if (!currentUser?.email) return null;
    return syncUserWithBackend(
      currentUser.email,
      currentUser.displayName || currentUser.email.split('@')[0],
      phone,
      currentUser,
      { force: true }
    );
  };

  const updateProfileInBackend = async (data) => {
    const updated = await userApi.updateProfile(data);
    setSessionState((prev) => {
      const nextProfile = { ...(prev.profile || {}), ...updated };
      return {
        status: SESSION_STATUS.AUTHENTICATED,
        session: prev.session,
        profile: nextProfile,
        roles: buildRoleState(nextProfile, prev.session?.emailVerified),
        error: null,
      };
    });
    if (currentUser) {
      refreshSession(currentUser, { force: true, silent: true }).catch(() => {});
    }
    return updated;
  };

  const activateSeller = async () => {
    const response = await userApi.activateSeller();
    if (currentUser) {
      await refreshSession(currentUser, { force: true, silent: true });
    }
    return response;
  };

  const deactivateSeller = async () => {
    const response = await userApi.deactivateSeller();
    if (currentUser) {
      await refreshSession(currentUser, { force: true, silent: true });
    }
    return response;
  };

  useEffect(() => {
    let isMounted = true;

    const bootstrapTimeout = setTimeout(() => {
      if (!isMounted || sessionStateRef.current.status !== SESSION_STATUS.BOOTSTRAP) return;
      setSessionState({
        status: SESSION_STATUS.RECOVERABLE_ERROR,
        session: null,
        profile: null,
        roles: EMPTY_ROLES,
        error: {
          message: 'Authentication bootstrap timed out. Retry to recover your session.',
        },
      });
    }, BOOTSTRAP_TIMEOUT_MS);

    if (!isFirebaseReady || !auth) {
      setCurrentUser(null);
      applySignedOutState();
      clearTimeout(bootstrapTimeout);
      return () => {
        isMounted = false;
      };
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!isMounted) return;

      setCurrentUser(user);

      if (!user) {
        applySignedOutState();
        return;
      }

      resetSyncTracking();
      setSessionState({
        status: SESSION_STATUS.LOADING,
        session: buildFirebaseSessionFallback(user),
        profile: null,
        roles: EMPTY_ROLES,
        error: null,
      });

      refreshSession(user, { force: true }).catch((error) => {
        console.error('Auth session refresh failed:', error?.message || error);
      });
    });

    return () => {
      isMounted = false;
      clearTimeout(bootstrapTimeout);
      unsubscribe();
    };
  }, []);

  const value = {
    currentUser,
    dbUser: sessionState.profile,
    session: sessionState.session,
    profile: sessionState.profile,
    roles: sessionState.roles,
    status: sessionState.status,
    sessionError: sessionState.error,
    loading: sessionState.status === SESSION_STATUS.BOOTSTRAP || sessionState.status === SESSION_STATUS.LOADING,
    isAuthenticated: Boolean(currentUser),
    signup,
    login,
    signInWithGoogle,
    signInWithFacebook,
    signInWithX,
    logout,
    forgotPassword,
    refreshSession,
    syncUserWithBackend,
    updatePhone,
    updateProfile: updateProfileInBackend,
    activateSeller,
    deactivateSeller,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
