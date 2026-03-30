import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  signInWithEmailAndPassword,
  signInWithCredential,
  signInWithRedirect,
  signOut,
  onAuthStateChanged,
  updateProfile as updateFirebaseProfile,
  signInWithPopup,
} from 'firebase/auth';
import {
  auth,
  googleProvider,
  facebookProvider,
  xProvider,
  assertFirebaseReady,
  assertFirebaseSocialAuthReady,
  clearFirebaseSocialAuthRuntimeBlock,
  isFirebaseReady,
  markFirebaseSocialAuthRejectedForRuntime,
  shouldPreferFirebaseRedirectAuth,
} from '../config/firebase';
import { authApi, userApi } from '../services/api';
import { clearCsrfTokenCache } from '../services/csrfTokenManager';
import { clearAuthJourneyDraft, writeAuthIdentityMemory } from '../utils/authAcceleration';

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
  intelligence: null,
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

const buildSessionIntelligenceFallback = (session = null, profile = null, roles = EMPTY_ROLES) => {
  const providerIds = Array.isArray(session?.providerIds) ? session.providerIds : [];
  const assuranceLevel = roles?.isVerified ? 'password' : 'none';

  return {
    assurance: {
      level: assuranceLevel,
      label: roles?.isVerified ? 'Verified session' : 'Standard session',
      verifiedAt: session?.authTime || null,
      expiresAt: session?.expiresAt || null,
      isRecent: Boolean(session?.authTime),
    },
    readiness: {
      hasVerifiedEmail: Boolean(session?.emailVerified || roles?.isVerified),
      hasPhone: Boolean(profile?.phone || session?.phone),
      accountState: profile?.accountState || 'active',
      isPrivileged: Boolean(roles?.isAdmin || roles?.isSeller),
    },
    acceleration: {
      suggestedRoute: providerIds.some((providerId) => /google|facebook|twitter|x\.com/i.test(providerId))
        ? 'social'
        : 'password',
      rememberedIdentifier: Boolean(profile?.phone || session?.phone) ? 'email+phone' : 'email',
      suggestedProvider: providerIds[0] || '',
      providerIds,
    },
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
    intelligence: payload?.intelligence || buildSessionIntelligenceFallback(session, profile, roles),
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
        if (import.meta.env.DEV) {
          console.warn(`AuthContext: Invalid state transition attempted from ${prev.status} to ${nextState.status}`);
        }
      }
      return nextState;
    });
  };
  const syncStateRef = useRef({
    identity: '',
    lastSyncedAt: 0,
    inFlight: null,
  });
  const controlledAuthFlowRef = useRef({
    uid: '',
    email: '',
  });
  const sessionStateRef = useRef(EMPTY_SESSION_STATE);
  const redirectResolutionRef = useRef(false);

  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  useEffect(() => {
    if (!sessionState.profile?.email) return;
    if (![SESSION_STATUS.AUTHENTICATED, SESSION_STATUS.LATTICE_CHALLENGE].includes(sessionState.status)) return;

    writeAuthIdentityMemory({
      email: sessionState.session?.email || sessionState.profile.email,
      phone: sessionState.profile?.phone || sessionState.session?.phone || '',
      displayName: sessionState.profile?.name || sessionState.session?.displayName || '',
      assuranceLevel: sessionState.intelligence?.assurance?.level || '',
      assuranceLabel: sessionState.intelligence?.assurance?.label || '',
      providerIds: sessionState.intelligence?.acceleration?.providerIds || sessionState.session?.providerIds || [],
    });
    clearAuthJourneyDraft();
  }, [sessionState]);

  const resetSyncTracking = () => {
    syncStateRef.current = {
      identity: '',
      lastSyncedAt: 0,
      inFlight: null,
    };
  };

  const setControlledAuthFlow = ({ uid = '', email = '' } = {}) => {
    controlledAuthFlowRef.current = {
      uid: normalizeText(uid),
      email: normalizeEmail(email),
    };
  };

  const clearControlledAuthFlow = () => {
    setControlledAuthFlow();
  };

  const hasActiveControlledAuthFlow = () => Boolean(
    controlledAuthFlowRef.current.uid || controlledAuthFlowRef.current.email
  );

  const isControlledAuthFlow = (firebaseUser = null) => {
    if (!firebaseUser) return false;

    const pending = controlledAuthFlowRef.current;
    const uid = normalizeText(firebaseUser.uid);
    const email = normalizeEmail(firebaseUser.email);

    return Boolean(
      (pending.uid && pending.uid === uid)
      || (pending.email && pending.email === email)
    );
  };

  const applySignedOutState = () => {
    clearCsrfTokenCache();
    resetSyncTracking();
    clearControlledAuthFlow();
    setSessionState({
      status: SESSION_STATUS.SIGNED_OUT,
      latticeChallenge: null,
      session: null,
      intelligence: null,
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
      intelligence: buildSessionIntelligenceFallback(buildFirebaseSessionFallback(firebaseUser), null, EMPTY_ROLES),
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
    flowToken = '',
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
      const sessionFallback = buildFirebaseSessionFallback(activeUser);
      setSessionState((prev) => ({
        status: prev.status === SESSION_STATUS.BOOTSTRAP ? SESSION_STATUS.BOOTSTRAP : SESSION_STATUS.LOADING,
        latticeChallenge: syncStateRef.current.identity === identity ? (prev.latticeChallenge || null) : null,
        session: syncStateRef.current.identity === identity
          ? (prev.session || sessionFallback)
          : sessionFallback,
        intelligence: syncStateRef.current.identity === identity
          ? (prev.intelligence || buildSessionIntelligenceFallback(prev.session || sessionFallback, prev.profile, prev.roles))
          : buildSessionIntelligenceFallback(sessionFallback, null, EMPTY_ROLES),
        profile: syncStateRef.current.identity === identity ? prev.profile : null,
        roles: syncStateRef.current.identity === identity ? prev.roles : EMPTY_ROLES,
        error: null,
      }));
    }

    const requestPromise = (async () => {
      const payload = mode === 'sync'
        ? await authApi.syncSession(safeEmail, name, phone, {
          firebaseUser: activeUser,
          flowToken: normalizeText(flowToken),
        })
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
    flowToken: options?.flowToken || '',
    force: options?.force === true,
    silent: options?.silent === true,
  });

  const resolveOAuthUser = async (user, options = {}) => {
    if (!user) return null;

    const email = user.email || user.providerData?.find((entry) => entry?.email)?.email || '';

    if (!email) {
      throw new Error('Social account did not provide an email. Please use an account with email access or use another login method.');
    }

    const resolvedProfile = await syncUserWithBackend(
      email,
      user.displayName || email.split('@')[0],
      user.phoneNumber || '',
      user,
      { force: true, silent: options?.silent === true }
    );

    clearFirebaseSocialAuthRuntimeBlock();

    return {
      firebaseUser: user,
      dbUser: resolvedProfile,
      isNewUser: Boolean(options?.isNewUser),
      needsPhone: !resolvedProfile?.phone,
    };
  };

  const completeControlledAuthFlow = async ({ email = '', execute, finalize }) => {
    setControlledAuthFlow({ email });
    let shouldHoldGuardForAuthEvent = false;

    try {
      const result = await execute();
      const firebaseUser = result?.user || result?.firebaseUser || null;

      if (firebaseUser && hasActiveControlledAuthFlow()) {
        setControlledAuthFlow({
          uid: firebaseUser.uid,
          email: firebaseUser.email || email,
        });
        shouldHoldGuardForAuthEvent = true;
      }

      await finalize(result, firebaseUser);
      return result;
    } finally {
      if (!shouldHoldGuardForAuthEvent) {
        clearControlledAuthFlow();
      }
    }
  };

  const signup = async (email, password, name, phone) => {
    assertFirebaseReady('Sign up');
    return completeControlledAuthFlow({
      email,
      execute: async () => {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateFirebaseProfile(userCredential.user, { displayName: name });
        return userCredential;
      },
      finalize: async (_result, firebaseUser) => {
        await syncUserWithBackend(email, name, phone, firebaseUser, { force: true });
      },
    });
  };

  const login = async (email, password, options = {}) => {
    assertFirebaseReady('Sign in');
    return completeControlledAuthFlow({
      email,
      execute: async () => signInWithEmailAndPassword(auth, email, password),
      finalize: async (_result, firebaseUser) => {
        const flowToken = normalizeText(options?.loginFlowToken);
        if (flowToken) {
          await syncUserWithBackend(
            email,
            firebaseUser?.displayName || '',
            options?.phone || firebaseUser?.phoneNumber || '',
            firebaseUser,
            { force: true, flowToken }
          );
          return;
        }
        await refreshSession(firebaseUser, { force: true });
      },
    });
  };

  const loginWithPhoneCredential = async (credential, options = {}) => {
    assertFirebaseReady('Phone sign in');

    if (!credential) {
      throw new Error('Phone credential is required');
    }

    const expectedEmail = normalizeEmail(options?.email);

    return completeControlledAuthFlow({
      email: expectedEmail,
      execute: async () => {
        const result = await signInWithCredential(auth, credential);
        const resolvedEmail = normalizeEmail(result?.user?.email);

        if (expectedEmail && resolvedEmail && resolvedEmail !== expectedEmail) {
          await signOut(auth);
          throw new Error('Verified phone sign-in resolved to a different account.');
        }

        return result;
      },
      finalize: async (_result, firebaseUser) => {
        const flowToken = normalizeText(options?.loginFlowToken);
        if (flowToken) {
          await syncUserWithBackend(
            expectedEmail || firebaseUser?.email || '',
            firebaseUser?.displayName || '',
            options?.phone || firebaseUser?.phoneNumber || '',
            firebaseUser,
            { force: true, flowToken }
          );
          return;
        }
        await refreshSession(firebaseUser, { force: true });
      },
    });
  };

  const signInWithOAuthProvider = async (provider, providerLabel = 'OAuth') => {
    try {
      assertFirebaseSocialAuthReady(`${providerLabel} sign-in`);
      if (shouldPreferFirebaseRedirectAuth()) {
        await signInWithRedirect(auth, provider);
        return { redirecting: true };
      }
      const result = await signInWithPopup(auth, provider);
      return resolveOAuthUser(result.user, {
        isNewUser: result._tokenResponse?.isNewUser || false,
      });
    } catch (error) {
      const errorCode = String(error?.code || '');
      const canFallbackToRedirect = [
        'auth/popup-blocked',
        'auth/operation-not-supported-in-this-environment',
        'auth/web-storage-unsupported',
      ].includes(errorCode);

      if (canFallbackToRedirect) {
        await signInWithRedirect(auth, provider);
        return { redirecting: true };
      }

      markFirebaseSocialAuthRejectedForRuntime(error);
      throw error;
    }
  };

  const signInWithGoogle = async () => signInWithOAuthProvider(googleProvider, 'Google');
  const signInWithFacebook = async () => signInWithOAuthProvider(facebookProvider, 'Facebook');
  const signInWithX = async () => signInWithOAuthProvider(xProvider, 'X');

  useEffect(() => {
    if (!isFirebaseReady || !auth || redirectResolutionRef.current) return undefined;

    redirectResolutionRef.current = true;

    getRedirectResult(auth)
      .then((result) => {
        if (!result?.user) return null;
        return resolveOAuthUser(result.user, {
          isNewUser: result._tokenResponse?.isNewUser || false,
          silent: true,
        });
      })
      .catch((error) => {
        if (!error) return;
        markFirebaseSocialAuthRejectedForRuntime(error);
      });

    return undefined;
  }, []);

  const logout = async () => {
    clearCsrfTokenCache();
    clearAuthJourneyDraft();
    setCurrentUser(null);
    applySignedOutState();

    if (!isFirebaseReady || !auth) {
      return;
    }

    await signOut(auth);
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
      const nextRoles = buildRoleState(nextProfile, prev.session?.emailVerified);
      return {
        status: SESSION_STATUS.AUTHENTICATED,
        latticeChallenge: prev.latticeChallenge || null,
        session: prev.session,
        intelligence: buildSessionIntelligenceFallback(prev.session, nextProfile, nextRoles),
        profile: nextProfile,
        roles: nextRoles,
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
        intelligence: null,
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

      if (isControlledAuthFlow(user)) {
        clearControlledAuthFlow();
        return;
      }

      resetSyncTracking();
      const sessionFallback = buildFirebaseSessionFallback(user);
      setSessionState({
        status: SESSION_STATUS.LOADING,
        latticeChallenge: null,
        session: sessionFallback,
        intelligence: buildSessionIntelligenceFallback(sessionFallback, null, EMPTY_ROLES),
        profile: null,
        roles: EMPTY_ROLES,
        error: null,
      });

      refreshSession(user, { force: true }).catch(() => {});
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
    sessionIntelligence: sessionState.intelligence,
    profile: sessionState.profile,
    roles: sessionState.roles,
    status: sessionState.status,
    latticeChallenge: sessionState.latticeChallenge,
    sessionError: sessionState.error,
    loading: sessionState.status === SESSION_STATUS.BOOTSTRAP || sessionState.status === SESSION_STATUS.LOADING,
    isAuthenticated: Boolean(currentUser),
    signup,
    login,
    loginWithPhoneCredential,
    signInWithGoogle,
    signInWithFacebook,
    signInWithX,
    logout,
    refreshSession,
    syncUserWithBackend,
    updatePhone,
    updateProfile: updateProfileInBackend,
    activateSeller,
    deactivateSeller,
    verifyLatticeChallenge: async (token, proof, deviceId) => {
      const response = await authApi.verifyLatticeChallenge(token, proof, deviceId);
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
