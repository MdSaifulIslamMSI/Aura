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
import { cacheTrustedDeviceSessionToken, clearTrustedDeviceSessionToken } from '../services/deviceTrustClient';
import { clearAuthJourneyDraft, writeAuthIdentityMemory } from '../utils/authAcceleration';
import { getUserVisibleEmail } from '../utils/authIdentity';
import {
  buildFirebaseSessionFallback,
  isAuthenticatedSessionStatus,
  buildRoleState,
  buildSessionIntelligenceFallback,
  buildSessionStateFromPayload,
  EMPTY_ROLES,
  EMPTY_SESSION_STATE,
  normalizeEmail,
  normalizePhone,
  normalizeText,
  SESSION_STATUS,
  VALID_TRANSITIONS,
} from './authSessionState';

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
const REDIRECT_AUTH_PENDING_KEY = 'aura-social-auth-redirect-pending';
const REDIRECT_AUTH_PENDING_TTL_MS = 5 * 60 * 1000;

const readRedirectAuthPending = () => {
  if (typeof window === 'undefined') return false;

  try {
    const rawValue = window.sessionStorage.getItem(REDIRECT_AUTH_PENDING_KEY);
    if (!rawValue) return false;

    const parsed = JSON.parse(rawValue);
    const startedAt = Number(parsed?.startedAt || 0);
    if (!startedAt || (Date.now() - startedAt) > REDIRECT_AUTH_PENDING_TTL_MS) {
      window.sessionStorage.removeItem(REDIRECT_AUTH_PENDING_KEY);
      return false;
    }

    return true;
  } catch {
    return false;
  }
};

const markRedirectAuthPending = () => {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(REDIRECT_AUTH_PENDING_KEY, JSON.stringify({
      startedAt: Date.now(),
    }));
  } catch {
    // best-effort only
  }
};

const clearRedirectAuthPending = () => {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.removeItem(REDIRECT_AUTH_PENDING_KEY);
  } catch {
    // best-effort only
  }
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
    pending: false,
  });
  const sessionStateRef = useRef(EMPTY_SESSION_STATE);
  const redirectResolutionRef = useRef(false);

  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  useEffect(() => {
    if (![SESSION_STATUS.AUTHENTICATED, SESSION_STATUS.DEVICE_CHALLENGE].includes(sessionState.status)) return;

    const visibleEmail = getUserVisibleEmail(sessionState.session?.email || sessionState.profile?.email || '');
    const visiblePhone = sessionState.profile?.phone || sessionState.session?.phone || '';
    if (!visibleEmail && !visiblePhone) return;

    writeAuthIdentityMemory({
      email: visibleEmail,
      phone: visiblePhone,
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

  const setControlledAuthFlow = ({ uid = '', email = '', pending = false } = {}) => {
    controlledAuthFlowRef.current = {
      uid: normalizeText(uid),
      email: normalizeEmail(email),
      pending: Boolean(pending),
    };
  };

  const clearControlledAuthFlow = () => {
    setControlledAuthFlow();
  };

  const hasActiveControlledAuthFlow = () => Boolean(
    controlledAuthFlowRef.current.pending
    || controlledAuthFlowRef.current.uid
    || controlledAuthFlowRef.current.email
  );

  const isControlledAuthFlow = (firebaseUser = null) => {
    if (!firebaseUser) return false;

    const pending = controlledAuthFlowRef.current;
    const uid = normalizeText(firebaseUser.uid);
    const email = normalizeEmail(firebaseUser.email);

    if (pending.pending) {
      return true;
    }

    return Boolean(
      (pending.uid && pending.uid === uid)
      || (pending.email && pending.email === email)
    );
  };

  const applySignedOutState = () => {
    clearCsrfTokenCache();
    clearTrustedDeviceSessionToken();
    resetSyncTracking();
    clearControlledAuthFlow();
    clearRedirectAuthPending();
    setSessionState({
      status: SESSION_STATUS.SIGNED_OUT,
      deviceChallenge: null,
      session: null,
      intelligence: null,
      profile: null,
      roles: EMPTY_ROLES,
      error: null,
    });
  };

  const applySessionLoadingState = (firebaseUser) => {
    resetSyncTracking();
    const sessionFallback = buildFirebaseSessionFallback(firebaseUser);
    setSessionState({
      status: SESSION_STATUS.LOADING,
      deviceChallenge: null,
      session: sessionFallback,
      intelligence: buildSessionIntelligenceFallback(sessionFallback, null, EMPTY_ROLES),
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
      && [SESSION_STATUS.AUTHENTICATED, SESSION_STATUS.DEVICE_CHALLENGE].includes(previousState.status);

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
      deviceChallenge: null,
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
      && [SESSION_STATUS.AUTHENTICATED, SESSION_STATUS.DEVICE_CHALLENGE].includes(state.status)
      && state.profile
      && (Date.now() - syncStateRef.current.lastSyncedAt) < AUTH_SYNC_DEDUPE_MS;
  };

  const isUnauthorizedSessionError = (error) => {
    const status = Number(error?.status || error?.data?.statusCode || 0);
    if (status === 401) return true;

    const code = normalizeText(error?.code || error?.data?.code || '');
    const message = String(error?.message || '').toLowerCase();

    return code === 'auth_token_invalid'
      || message.includes('not authorized, token failed')
      || message.includes('authenticated account is missing email')
      || message.includes('authenticated account is missing identity')
      || (message.includes('csrf token fetch failed') && message.includes('http 401'));
  };

  const invalidateStaleAuthSession = async (error, activeUser = null) => {
    clearCsrfTokenCache();
    clearTrustedDeviceSessionToken();
    resetSyncTracking();
    clearControlledAuthFlow();
    clearRedirectAuthPending();
    setCurrentUser(null);
    setSessionState({
      status: SESSION_STATUS.SIGNED_OUT,
      deviceChallenge: null,
      session: null,
      intelligence: null,
      profile: null,
      roles: EMPTY_ROLES,
      error: {
        message: error?.message || 'Your sign-in expired. Please sign in again.',
      },
    });

    if (!isFirebaseReady || !auth || !(activeUser || auth.currentUser)) {
      return;
    }

    try {
      await signOut(auth);
    } catch {
      // The local auth state is already reset above; swallow provider cleanup errors.
    }
  };

  const rollbackProviderAuthSession = async (error, activeUser = null) => {
    clearCsrfTokenCache();
    clearTrustedDeviceSessionToken();
    resetSyncTracking();
    clearControlledAuthFlow();
    clearRedirectAuthPending();
    setCurrentUser(null);
    setSessionState({
      status: SESSION_STATUS.SIGNED_OUT,
      deviceChallenge: null,
      session: null,
      intelligence: null,
      profile: null,
      roles: EMPTY_ROLES,
      error: {
        message: error?.message || 'Provider sign-in could not be completed.',
      },
    });

    if (!isFirebaseReady || !auth || !(activeUser || auth.currentUser)) {
      return;
    }

    try {
      await signOut(auth);
    } catch {
      // Local auth state has already been reset above.
    }
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
    const safeUid = normalizeText(activeUser?.uid);

    if (!activeUser || (!safeEmail && !safeUid)) {
      applySignedOutState();
      return null;
    }

    const identity = getIdentityKey(activeUser, safeEmail);

    if (syncStateRef.current.identity && syncStateRef.current.identity !== identity) {
      clearCsrfTokenCache();
      clearTrustedDeviceSessionToken();
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
        deviceChallenge: syncStateRef.current.identity === identity ? (prev.deviceChallenge || null) : null,
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
      .catch(async (error) => {
        if (isUnauthorizedSessionError(error)) {
          await invalidateStaleAuthSession(error, activeUser);
          throw error;
        }

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

    try {
      const email = user.email || user.providerData?.find((entry) => entry?.email)?.email || '';
      const resolvedDisplayName = user.displayName || (email ? email.split('@')[0] : 'Aura User');

      const resolvedProfile = await syncUserWithBackend(
        email,
        resolvedDisplayName,
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
    } catch (error) {
      if (!isUnauthorizedSessionError(error)) {
        await rollbackProviderAuthSession(error, user);
      }
      throw error;
    }
  };

  const completeControlledAuthFlow = async ({ email = '', execute, finalize }) => {
    setControlledAuthFlow({ email, pending: true });
    let shouldHoldGuardForAuthEvent = false;

    try {
      const result = await execute();
      const firebaseUser = result?.user || result?.firebaseUser || null;

      if (firebaseUser && hasActiveControlledAuthFlow()) {
        setControlledAuthFlow({
          uid: firebaseUser.uid,
          email: firebaseUser.email || email,
          pending: false,
        });
        shouldHoldGuardForAuthEvent = true;
      }

      const finalizedResult = await finalize(result, firebaseUser);
      return finalizedResult ?? result;
    } finally {
      if (!shouldHoldGuardForAuthEvent) {
        clearControlledAuthFlow();
      }
    }
  };

  const beginRedirectOAuthFlow = async (provider) => {
    markRedirectAuthPending();

    try {
      await signInWithRedirect(auth, provider);
      return { redirecting: true };
    } catch (error) {
      clearRedirectAuthPending();
      throw error;
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
        return beginRedirectOAuthFlow(provider);
      }
      return completeControlledAuthFlow({
        execute: async () => signInWithPopup(auth, provider),
        finalize: async (result, firebaseUser) => resolveOAuthUser(firebaseUser, {
          isNewUser: result?._tokenResponse?.isNewUser || false,
        }),
      });
    } catch (error) {
      const errorCode = String(error?.code || '');
      const canFallbackToRedirect = [
        'auth/popup-blocked',
        'auth/operation-not-supported-in-this-environment',
        'auth/web-storage-unsupported',
      ].includes(errorCode);

      if (canFallbackToRedirect) {
        return beginRedirectOAuthFlow(provider);
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

    let isMounted = true;

    getRedirectResult(auth)
      .then((result) => {
        if (!isMounted) return null;

        if (!result?.user) {
          clearRedirectAuthPending();
          if (auth.currentUser && !hasActiveControlledAuthFlow()) {
            return refreshSession(auth.currentUser, { force: true, silent: true }).catch(() => {});
          }
          return null;
        }

        return resolveOAuthUser(result.user, {
          isNewUser: result._tokenResponse?.isNewUser || false,
          silent: true,
        }).finally(() => {
          clearRedirectAuthPending();
        });
      })
      .catch((error) => {
        clearRedirectAuthPending();
        if (!error) return;
        markFirebaseSocialAuthRejectedForRuntime(error);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const logout = async () => {
    clearCsrfTokenCache();
    clearAuthJourneyDraft();
    clearRedirectAuthPending();
    setCurrentUser(null);
    applySignedOutState();

    if (!isFirebaseReady || !auth) {
      return;
    }

    await signOut(auth);
  };

  const updatePhone = async (phone) => {
    if (!currentUser) return null;
    const resolvedEmail = normalizeEmail(currentUser.email || sessionStateRef.current.profile?.email || '');
    const resolvedName = currentUser.displayName || sessionStateRef.current.profile?.name || resolvedEmail.split('@')[0] || 'Aura User';
    return syncUserWithBackend(
      resolvedEmail,
      resolvedName,
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
        deviceChallenge: prev.deviceChallenge || null,
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
        deviceChallenge: null,
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
      applySessionLoadingState(user);

      if (readRedirectAuthPending() && !isControlledAuthFlow(user)) {
        return;
      }

      if (isControlledAuthFlow(user)) {
        clearControlledAuthFlow();
        return;
      }

      refreshSession(user, { force: true }).catch(() => {});
    });

    return () => {
      isMounted = false;
      clearTimeout(bootstrapTimeout);
      unsubscribe();
    };
  }, []);

  const verifyDeviceChallenge = async (token, proofOrPayload, publicKeySpkiBase64 = '') => {
    const challengePayload = proofOrPayload && typeof proofOrPayload === 'object' && !Array.isArray(proofOrPayload)
      ? proofOrPayload
      : {
        method: 'browser_key',
        proofBase64: proofOrPayload,
        publicKeySpkiBase64,
      };
    const response = await authApi.verifyDeviceChallenge(token, challengePayload, '', {
      firebaseUser: currentUser,
    });
    if (response?.deviceSessionToken) {
      cacheTrustedDeviceSessionToken(response.deviceSessionToken);
    }
    if (response.success) {
      setSessionState((prev) => ({
        ...prev,
        status: SESSION_STATUS.AUTHENTICATED,
        deviceChallenge: null,
        error: null,
      }));
      if (currentUser) {
        refreshSession(currentUser, { force: true, silent: true }).catch(() => {});
      }
    }
    return response;
  };

  const verifyLatticeChallenge = async (token, proof, _deviceId) => (
    verifyDeviceChallenge(token, proof, '')
  );

  const isAuthenticated = isAuthenticatedSessionStatus(sessionState.status);

  const value = {
    currentUser,
    dbUser: sessionState.profile,
    session: sessionState.session,
    sessionIntelligence: sessionState.intelligence,
    profile: sessionState.profile,
    roles: sessionState.roles,
    status: sessionState.status,
    deviceChallenge: sessionState.deviceChallenge,
    sessionError: sessionState.error,
    loading: sessionState.status === SESSION_STATUS.BOOTSTRAP || sessionState.status === SESSION_STATUS.LOADING,
    isAuthenticated,
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
    verifyDeviceChallenge,
    verifyLatticeChallenge,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
