import { createContext, useContext, useEffect, useRef, useState } from 'react';
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
import { clearCsrfTokenCache } from '../services/csrfTokenManager';

export const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
};

const AUTH_SYNC_DEDUPE_MS = 5 * 1000;  // Reduced from 30s for faster security updates
const BOOTSTRAP_TIMEOUT_MS = 6000;

const SESSION_STATUS = {
  BOOTSTRAP: 'bootstrap',
  LOADING: 'loading',
  AUTHENTICATED: 'authenticated',
  LATTICE_CHALLENGE: 'lattice_challenge_required',
  RECOVERABLE_ERROR: 'recoverable_error',
  SIGNED_OUT: 'signed_out',
};

const VALID_TRANSITIONS = {
  [SESSION_STATUS.BOOTSTRAP]: [SESSION_STATUS.LOADING, SESSION_STATUS.SIGNED_OUT, SESSION_STATUS.RECOVERABLE_ERROR],
  [SESSION_STATUS.LOADING]: [SESSION_STATUS.AUTHENTICATED, SESSION_STATUS.SIGNED_OUT, SESSION_STATUS.RECOVERABLE_ERROR, SESSION_STATUS.LATTICE_CHALLENGE],
  [SESSION_STATUS.AUTHENTICATED]: [SESSION_STATUS.SIGNED_OUT, SESSION_STATUS.LOADING, SESSION_STATUS.LATTICE_CHALLENGE],
  [SESSION_STATUS.LATTICE_CHALLENGE]: [SESSION_STATUS.AUTHENTICATED, SESSION_STATUS.SIGNED_OUT, SESSION_STATUS.LOADING],
  [SESSION_STATUS.RECOVERABLE_ERROR]: [SESSION_STATUS.LOADING, SESSION_STATUS.SIGNED_OUT, SESSION_STATUS.AUTHENTICATED],
  [SESSION_STATUS.SIGNED_OUT]: [SESSION_STATUS.LOADING, SESSION_STATUS.BOOTSTRAP],
};

const EMPTY_ROLES = {
  isAdmin: false,
  isSeller: false,
  isVerified: false,
};

const EMPTY_SESSION_STATE = {
  status: SESSION_STATUS.BOOTSTRAP,
  latticeChallenge: null,
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
    latticeChallenge: payload?.latticeChallenge || null,
    session,
    profile,
    roles,
    error: payload?.error || null,
  };
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [sessionState, setSessionStateInternal] = useState(EMPTY_SESSION_STATE);

  const setSessionState = (next) => {
    setSessionStateInternal((prev) => {
      const nextState = typeof next === 'function' ? next(prev) : next;
      if (prev.status === nextState.status) return nextState;
      
      const allowed = VALID_TRANSITIONS[prev.status] || [];
      if (!allowed.includes(nextState.status)) {
        console.warn(`AuthContext: Invalid state transition attempted from ${prev.status} to ${nextState.status}`);
        // In production, we might want to allow it anyway but log it, 
        // or force a specific path. For now, we allow it but warn.
      }
      return nextState;
    });
  };
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
    clearCsrfTokenCache();
    resetSyncTracking();
    setSessionState({
      status: SESSION_STATUS.SIGNED_OUT,
      latticeChallenge: null,
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
    const previousState = sessionStateRef.current;
    const canPreserveResolvedSession = previousState.profile
      && syncStateRef.current.identity === identity
      && [SESSION_STATUS.AUTHENTICATED, SESSION_STATUS.LATTICE_CHALLENGE].includes(previousState.status);

    if (canPreserveResolvedSession) {
      setSessionState({
        ...previousState,
        session: previousState.session || buildFirebaseSessionFallback(firebaseUser),
        error: {
          message: error?.message || 'Session refresh failed. Using the last verified profile for now.',
        },
      });
      syncStateRef.current = {
        identity,
        lastSyncedAt: syncStateRef.current.lastSyncedAt,
        inFlight: null,
      };
      return;
    }

    setSessionState({
      status: SESSION_STATUS.RECOVERABLE_ERROR,
      latticeChallenge: null,
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
      && [SESSION_STATUS.AUTHENTICATED, SESSION_STATUS.LATTICE_CHALLENGE].includes(state.status)
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

    if (syncStateRef.current.identity && syncStateRef.current.identity !== identity) {
      clearCsrfTokenCache();
    }

    if (shouldReuseResolvedSession(identity, force)) {
      return sessionStateRef.current.profile;
    }

    if (!force && syncStateRef.current.identity === identity && syncStateRef.current.inFlight) {
      return syncStateRef.current.inFlight;
    }

    if (!silent) {
      setSessionState((prev) => ({
        status: prev.status === SESSION_STATUS.BOOTSTRAP ? SESSION_STATUS.BOOTSTRAP : SESSION_STATUS.LOADING,
        latticeChallenge: syncStateRef.current.identity === identity ? (prev.latticeChallenge || null) : null,
        session: syncStateRef.current.identity === identity
          ? (prev.session || buildFirebaseSessionFallback(activeUser))
          : buildFirebaseSessionFallback(activeUser),
        profile: syncStateRef.current.identity === identity ? prev.profile : null,
        roles: syncStateRef.current.identity === identity ? prev.roles : EMPTY_ROLES,
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
    clearCsrfTokenCache();
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
        latticeChallenge: prev.latticeChallenge || null,
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
        latticeChallenge: null,
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

      clearCsrfTokenCache();
      resetSyncTracking();
      setSessionState({
        status: SESSION_STATUS.LOADING,
        latticeChallenge: null,
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
        latticeChallenge: sessionState.latticeChallenge,
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
    verifyLatticeChallenge: async (challengeId, proof) => {
      const response = await authApi.verifyLatticeChallenge(challengeId, proof);
      if (response.success) {
        setSessionState((prev) => ({
          ...prev,
          status: SESSION_STATUS.AUTHENTICATED,
          latticeChallenge: null,
          error: null,
        }));
      }
      return response;
    },
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
