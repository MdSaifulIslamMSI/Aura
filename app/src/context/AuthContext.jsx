import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createIntl, createIntlCache, defineMessages } from 'react-intl';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  FacebookAuthProvider,
  getRedirectResult,
  GithubAuthProvider,
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  linkWithRedirect,
  OAuthProvider,
  signInWithEmailAndPassword,
  signInWithCredential,
  signInWithCustomToken,
  signInWithRedirect,
  signOut,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  reauthenticateWithRedirect,
  updateProfile as updateFirebaseProfile,
  signInWithPopup,
  TwitterAuthProvider,
} from 'firebase/auth';
import {
  auth,
  googleProvider,
  facebookProvider,
  githubProvider,
  microsoftProvider,
  appleProvider,
  xProvider,
  assertFirebaseReady,
  assertFirebaseSocialAuthReady,
  clearFirebaseSocialAuthRuntimeBlock,
  isFirebaseReady,
  markFirebaseSocialAuthRejectedForRuntime,
  shouldPreferFirebaseRedirectAuth,
} from '../config/firebase';
import { authApi, userApi } from '../services/api';
import { resetBrowserSessionState } from '../services/browserSessionReset';
import { clearCsrfTokenCache } from '../services/csrfTokenManager';
import { cacheTrustedDeviceSessionToken, clearTrustedDeviceSessionToken } from '../services/deviceTrustClient';
import {
  shouldUseNativeSocialAuth,
  signInWithNativeSocialProvider,
  signOutNativeSocialAuth,
} from '../services/nativeSocialAuth';
import { clearAuthJourneyDraft, writeAuthIdentityMemory } from '../utils/authAcceleration';
import { getUserVisibleEmail } from '../utils/authIdentity';
import { useActiveWindowRefresh } from '../hooks/useActiveWindowRefresh';
import { catalogs } from '../i18n/catalogs';
import { useOptionalLocale } from '../i18n/LocaleProvider';
import {
  buildFirebaseSessionFallback,
  isAuthenticatedSessionStatus,
  buildRoleState,
  buildSessionIntelligenceFallback,
  buildSessionStateFromPayload,
  EMPTY_ROLES,
  EMPTY_SESSION_STATE,
  normalizeEmail,
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
const DESKTOP_BROWSER_SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;
const REDIRECT_AUTH_PENDING_KEY = 'aura-social-auth-redirect-pending';
const REDIRECT_AUTH_PENDING_TTL_MS = 5 * 60 * 1000;
const authContextIntlCache = createIntlCache();
const authContextMessages = defineMessages({
  bootstrapTimedOut: {
    id: 'auth.session.bootstrapTimedOut',
    defaultMessage: 'Authentication bootstrap timed out. Retry to recover your session.',
  },
});
const OAUTH_CREDENTIAL_EXTRACTORS = [
  GithubAuthProvider,
  GoogleAuthProvider,
  FacebookAuthProvider,
  OAuthProvider,
  TwitterAuthProvider,
];

const hasLinkedProvider = (firebaseUser, providerId) => (
  Array.isArray(firebaseUser?.providerData)
  && firebaseUser.providerData.some((entry) => entry?.providerId === providerId)
);

const RECENT_REAUTH_REQUIRED_CODES = new Set([
  'WEBAUTHN_RECENT_AUTH_REQUIRED',
  'AUTH_FACTOR_CHANGE_RECENT_AUTH_REQUIRED',
  'RECENT_AUTH_REQUIRED',
]);
const FIREBASE_POPUP_REDIRECT_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/web-storage-unsupported',
]);
const SENSITIVE_REAUTH_REDIRECT_PENDING_CODE = 'auth/redirect-pending';
const SENSITIVE_PASSWORD_REAUTH_REQUIRED_CODE = 'auth/password-reauth-required';

const isRecentReauthRequiredError = (error) => {
  const status = Number(error?.status || error?.data?.status || 0);
  const code = normalizeText(error?.code || error?.data?.code || error?.data?.reasonCode || '').toUpperCase();
  const message = `${error?.message || ''} ${error?.data?.message || ''}`.toLowerCase();

  return status === 401 && (
    RECENT_REAUTH_REQUIRED_CODES.has(code)
    || message.includes('recent re-authentication is required')
    || message.includes('recent authentication is required')
  );
};

const canFallbackToRedirectAuth = (error) => (
  FIREBASE_POPUP_REDIRECT_FALLBACK_CODES.has(String(error?.code || ''))
);

const buildSensitiveReauthRedirectPendingError = (providerLabel = 'Provider') => {
  const error = new Error(
    `${providerLabel} re-authentication is continuing in the provider page. Return here after it completes, then retry this protected action.`
  );
  error.code = SENSITIVE_REAUTH_REDIRECT_PENDING_CODE;
  error.redirecting = true;
  return error;
};

const buildSensitivePasswordReauthRequiredError = (email = '') => {
  const error = new Error('Enter your password to refresh this protected session, then retry this action.');
  error.code = SENSITIVE_PASSWORD_REAUTH_REQUIRED_CODE;
  error.requiresPasswordReauth = true;
  error.email = email;
  return error;
};

const hasFreshSensitiveActionAuth = (sessionIntelligence) => {
  const session = sessionIntelligence?.posture?.session || {};
  const assurance = sessionIntelligence?.assurance || {};

  return Boolean(
    session.freshForSensitiveActions
    || session.stepUpActive
    || assurance.stepUpFresh
    || assurance.webAuthnStepUpFresh
    || assurance.freshWebAuthnStepUp
  );
};

const getSensitiveActionReauthProvider = (firebaseUser) => {
  const linkedProviderIds = Array.isArray(firebaseUser?.providerData)
    ? firebaseUser.providerData
      .map((entry) => normalizeText(entry?.providerId || ''))
      .filter(Boolean)
    : [];
  const providers = [
    { providerId: 'google.com', provider: googleProvider, label: 'Google' },
    { providerId: 'facebook.com', provider: facebookProvider, label: 'Facebook' },
    { providerId: 'github.com', provider: githubProvider, label: 'GitHub' },
    { providerId: 'microsoft.com', provider: microsoftProvider, label: 'Microsoft' },
    { providerId: 'apple.com', provider: appleProvider, label: 'Apple' },
    { providerId: 'twitter.com', provider: xProvider, label: 'X' },
  ];

  for (const linkedProviderId of linkedProviderIds) {
    const match = providers.find((entry) => entry.providerId === linkedProviderId && entry.provider);
    if (match) return match;
  }

  return null;
};

const canUsePasswordReauthProvider = (firebaseUser) => {
  const linkedProviderIds = Array.isArray(firebaseUser?.providerData)
    ? firebaseUser.providerData
      .map((entry) => normalizeText(entry?.providerId || ''))
      .filter(Boolean)
    : [];

  return linkedProviderIds.includes('password')
    || (!linkedProviderIds.length && Boolean(normalizeEmail(firebaseUser?.email || '')));
};

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

const buildRecoverableSessionErrorMessage = (error, fallbackMessage) => {
  const message = String(error?.message || '').trim();
  const status = Number(error?.status || error?.data?.statusCode || 0);
  const reference = String(
    error?.serverRequestId
    || error?.requestId
    || error?.data?.requestId
    || ''
  ).trim();
  const normalizedMessage = message.toLowerCase();

  if (
    status >= 500
    && (
      normalizedMessage.includes('something went wrong')
      || normalizedMessage.includes('request failed with status 500')
    )
  ) {
    return reference
      ? `Aura authenticated you, but the server could not finish session sync. Retry once; reference ${reference}.`
      : 'Aura authenticated you, but the server could not finish session sync. Retry once or reset sign-in.';
  }

  return message || fallbackMessage;
};

export const AuthProvider = ({ children }) => {
  const localeContext = useOptionalLocale();
  const authIntl = useMemo(() => createIntl({
    defaultLocale: 'en',
    locale: localeContext?.locale || 'en',
    messages: localeContext?.messages || catalogs.en,
    onError: () => {},
  }, authContextIntlCache), [localeContext?.locale, localeContext?.messages]);
  const [currentUser, setCurrentUser] = useState(null);
  const [sessionState, setSessionStateInternal] = useState(EMPTY_SESSION_STATE);
  const authIntlRef = useRef(authIntl);
  authIntlRef.current = authIntl;

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
  const pendingProviderLinkRef = useRef(null);

  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  useEffect(() => {
    if (![SESSION_STATUS.AUTHENTICATED, SESSION_STATUS.DEVICE_CHALLENGE, SESSION_STATUS.MFA_CHALLENGE].includes(sessionState.status)) return;

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
      mfaChallenge: null,
      mfaPolicy: null,
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
      mfaChallenge: null,
      mfaPolicy: null,
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
      && [SESSION_STATUS.AUTHENTICATED, SESSION_STATUS.DEVICE_CHALLENGE, SESSION_STATUS.MFA_CHALLENGE].includes(previousState.status);

    if (canPreserveResolvedSession) {
      setSessionState({
        ...previousState,
        session: previousState.session || buildFirebaseSessionFallback(firebaseUser),
        error: {
          message: buildRecoverableSessionErrorMessage(
            error,
            'Session refresh failed. Using the last verified profile for now.'
          ),
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
      mfaChallenge: null,
      mfaPolicy: null,
      session: buildFirebaseSessionFallback(firebaseUser),
      intelligence: buildSessionIntelligenceFallback(buildFirebaseSessionFallback(firebaseUser), null, EMPTY_ROLES),
      profile: null,
      roles: EMPTY_ROLES,
      error: {
        message: buildRecoverableSessionErrorMessage(
          error,
          'Unable to resolve account session right now.'
        ),
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
    try {
      await authApi.logoutSession({ firebaseUser: activeUser || auth?.currentUser || null });
    } catch {
      // best-effort cleanup only
    }

    clearCsrfTokenCache();
    clearTrustedDeviceSessionToken();
    resetSyncTracking();
    clearControlledAuthFlow();
    clearRedirectAuthPending();
    setCurrentUser(null);
    setSessionState({
      status: SESSION_STATUS.SIGNED_OUT,
      deviceChallenge: null,
      mfaChallenge: null,
      mfaPolicy: null,
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
    try {
      await authApi.logoutSession({ firebaseUser: activeUser || auth?.currentUser || null });
    } catch {
      // best-effort cleanup only
    }

    clearCsrfTokenCache();
    clearTrustedDeviceSessionToken();
    resetSyncTracking();
    clearControlledAuthFlow();
    clearRedirectAuthPending();
    setCurrentUser(null);
    setSessionState({
      status: SESSION_STATUS.SIGNED_OUT,
      deviceChallenge: null,
      mfaChallenge: null,
      mfaPolicy: null,
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
        mfaChallenge: syncStateRef.current.identity === identity ? (prev.mfaChallenge || null) : null,
        mfaPolicy: syncStateRef.current.identity === identity ? (prev.mfaPolicy || null) : null,
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

  useActiveWindowRefresh(
    () => refreshSession(currentUser, { force: true, silent: true }),
    { enabled: Boolean(currentUser?.uid) }
  );

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

  const extractOAuthCredentialFromError = (error) => {
    for (const extractor of OAUTH_CREDENTIAL_EXTRACTORS) {
      if (typeof extractor?.credentialFromError !== 'function') continue;
      try {
        const credential = extractor.credentialFromError(error);
        if (credential) return credential;
      } catch {
        // Try the next provider-specific extractor.
      }
    }

    return error?.credential || error?.githubCredential || error?.oauthCredential || null;
  };

  const rememberProviderCollision = (error, providerLabel, provider) => {
    if (String(error?.code || '') !== 'auth/account-exists-with-different-credential') return;

    const credential = extractOAuthCredentialFromError(error);
    if (!credential) return;

    pendingProviderLinkRef.current = {
      credential,
      email: normalizeEmail(error?.email || error?.customData?.email || ''),
      providerId: normalizeText(provider?.providerId || credential.providerId || error?.providerId || ''),
      providerLabel,
    };
  };

  const linkRememberedProviderAfterExistingSignIn = async (firebaseUser) => {
    const pending = pendingProviderLinkRef.current;
    if (!pending?.credential || !firebaseUser) return;

    const pendingEmail = normalizeEmail(pending.email);
    const signedInEmail = normalizeEmail(firebaseUser.email);
    if (pendingEmail && signedInEmail && pendingEmail !== signedInEmail) {
      return;
    }

    if (pending.providerId && hasLinkedProvider(firebaseUser, pending.providerId)) {
      pendingProviderLinkRef.current = null;
      return;
    }

    try {
      const linked = await linkWithCredential(firebaseUser, pending.credential);
      pendingProviderLinkRef.current = null;
      const linkedUser = linked?.user || firebaseUser;
      setCurrentUser(linkedUser);
      await refreshSession(linkedUser, { force: true, silent: true });
    } catch (error) {
      const code = String(error?.code || '');
      if (code === 'auth/provider-already-linked' || code === 'auth/credential-already-in-use') {
        pendingProviderLinkRef.current = null;
        return;
      }
      throw error;
    }
  };

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
      await linkRememberedProviderAfterExistingSignIn(firebaseUser);
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

  const beginRedirectSensitiveReauthFlow = async (activeUser, reauthProvider) => {
    markRedirectAuthPending();

    try {
      await reauthenticateWithRedirect(activeUser, reauthProvider.provider);
    } catch (error) {
      clearRedirectAuthPending();
      throw error;
    }

    throw buildSensitiveReauthRedirectPendingError(reauthProvider.label);
  };

  const getDesktopBridge = () => (
    typeof window !== 'undefined' && window.auraDesktop?.isDesktop
      ? window.auraDesktop
      : null
  );

  const waitForDesktopBrowserCustomToken = async (desktop, request) => new Promise((resolve, reject) => {
    let settled = false;
    const cleanupHandlers = [];

    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanupHandlers.splice(0).forEach((cleanup) => cleanup?.());
      callback(value);
    };

    const consumeCompletedToken = async ({ rejectOnFailure = false } = {}) => {
      if (settled) return;

      try {
        const result = await desktop.consumeBrowserSignIn(request.requestId);
        if (result?.success && result?.customToken) {
          settle(resolve, result.customToken);
          return;
        }

        if (rejectOnFailure && result?.message) {
          throw new Error(result.message);
        }
      } catch (error) {
        if (rejectOnFailure) {
          settle(reject, error);
        }
      }
    };

    const timeout = window.setTimeout(() => {
      settle(reject, new Error('Desktop browser sign-in expired. Start a fresh sign-in and try again.'));
    }, Math.max(
      1000,
      Math.min(
        DESKTOP_BROWSER_SIGN_IN_TIMEOUT_MS,
        Number(request?.expiresAt || 0) - Date.now() + 5000
      )
    ));
    cleanupHandlers.push(() => window.clearTimeout(timeout));

    const unsubscribe = desktop.onBrowserSignInStatus(async (payload = {}) => {
      if (payload.type !== 'completed' || payload.requestId !== request.requestId) {
        return;
      }

      await consumeCompletedToken({ rejectOnFailure: true });
    });
    cleanupHandlers.push(unsubscribe);

    const poll = window.setInterval(() => {
      void consumeCompletedToken();
    }, 1000);
    cleanupHandlers.push(() => window.clearInterval(poll));
    void consumeCompletedToken();
  });

  const signInWithDesktopBrowser = async ({ returnTo = '/' } = {}) => {
    assertFirebaseReady('Desktop browser sign-in');
    const desktop = getDesktopBridge();

    if (
      !desktop
      || typeof desktop.startBrowserSignIn !== 'function'
      || typeof desktop.consumeBrowserSignIn !== 'function'
      || typeof desktop.onBrowserSignInStatus !== 'function'
    ) {
      const error = new Error('Desktop browser sign-in is only available in the Aura desktop app.');
      error.code = 'auth/desktop-browser-sign-in-unavailable';
      throw error;
    }

    let request = null;
    try {
      return await completeControlledAuthFlow({
        execute: async () => {
          request = await desktop.startBrowserSignIn({
            path: '/desktop-login',
            returnTo,
          });
          const customToken = await waitForDesktopBrowserCustomToken(desktop, request);
          return signInWithCustomToken(auth, customToken);
        },
        finalize: async (_result, firebaseUser) => resolveOAuthUser(firebaseUser, {
          isNewUser: false,
        }),
      });
    } catch (error) {
      if (request?.requestId && typeof desktop.cancelBrowserSignIn === 'function') {
        await desktop.cancelBrowserSignIn(request.requestId).catch(() => {});
      }
      throw error;
    }
  };

  const signInWithDesktopOwnerAccess = async () => {
    assertFirebaseReady('Desktop owner access');
    const desktop = getDesktopBridge();

    if (!desktop || typeof desktop.signInWithOwnerAccess !== 'function') {
      const error = new Error('Desktop owner access is only available in the Aura desktop app.');
      error.code = 'auth/desktop-owner-access-unavailable';
      throw error;
    }

    return completeControlledAuthFlow({
      execute: async () => {
        const result = await desktop.signInWithOwnerAccess();
        if (!result?.success || !result?.customToken) {
          throw new Error(result?.message || 'Desktop owner access did not return a usable token.');
        }
        return signInWithCustomToken(auth, result.customToken);
      },
      finalize: async (_result, firebaseUser) => resolveOAuthUser(firebaseUser, {
        isNewUser: false,
      }),
    });
  };

  const signInWithEnterprise = async (options = {}) => authApi.startEnterpriseLogin({
    returnTo: options.returnTo,
    loginHint: options.loginHint || currentUser?.email || sessionStateRef.current.profile?.email || '',
  });

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

  const signInWithOAuthProvider = async (provider, providerLabel = 'OAuth', nativeProviderKey = '') => {
    try {
      assertFirebaseSocialAuthReady(`${providerLabel} sign-in`);
      if (!provider) {
        const error = new Error(`${providerLabel} sign-in is not enabled for this deployment.`);
        error.code = 'auth/provider-disabled';
        error.provider = providerLabel;
        throw error;
      }
      if (shouldUseNativeSocialAuth(nativeProviderKey)) {
        return completeControlledAuthFlow({
          execute: async () => signInWithNativeSocialProvider(nativeProviderKey, providerLabel),
          finalize: async (result, firebaseUser) => resolveOAuthUser(firebaseUser, {
            isNewUser: result?.additionalUserInfo?.isNewUser || result?._tokenResponse?.isNewUser || false,
          }),
        });
      }
      if (shouldPreferFirebaseRedirectAuth()) {
        return beginRedirectOAuthFlow(provider);
      }
      return completeControlledAuthFlow({
        execute: async () => signInWithPopup(auth, provider),
        finalize: async (result, firebaseUser) => resolveOAuthUser(firebaseUser, {
          isNewUser: result?.additionalUserInfo?.isNewUser || result?._tokenResponse?.isNewUser || false,
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

      rememberProviderCollision(error, providerLabel, provider);
      error.provider = error.provider || providerLabel;
      error.providerId = error.providerId || provider?.providerId || '';
      markFirebaseSocialAuthRejectedForRuntime(error);
      throw error;
    }
  };

  const beginRedirectProviderLinkFlow = async (provider) => {
    const activeUser = auth?.currentUser || currentUser;
    if (!activeUser) {
      throw new Error('Sign in before linking another provider.');
    }

    markRedirectAuthPending();

    try {
      await linkWithRedirect(activeUser, provider);
      return { redirecting: true };
    } catch (error) {
      clearRedirectAuthPending();
      throw error;
    }
  };

  const linkOAuthProvider = async (provider, providerLabel = 'OAuth', providerId = '') => {
    assertFirebaseReady(`${providerLabel} account linking`);
    assertFirebaseSocialAuthReady(`${providerLabel} account linking`);

    const activeUser = auth?.currentUser || currentUser;
    if (!activeUser) {
      throw new Error('Sign in before linking another provider.');
    }
    if (!provider) {
      const error = new Error(`${providerLabel} account linking is not enabled for this deployment.`);
      error.code = 'auth/provider-disabled';
      error.provider = providerLabel;
      throw error;
    }
    if (providerId && hasLinkedProvider(activeUser, providerId)) {
      return { firebaseUser: activeUser, alreadyLinked: true };
    }

    try {
      if (shouldPreferFirebaseRedirectAuth()) {
        return beginRedirectProviderLinkFlow(provider);
      }

      const result = await linkWithPopup(activeUser, provider);
      const linkedUser = result?.user || activeUser;
      setCurrentUser(linkedUser);
      await refreshSession(linkedUser, { force: true, silent: true });
      clearFirebaseSocialAuthRuntimeBlock();
      return { firebaseUser: linkedUser, alreadyLinked: false };
    } catch (error) {
      const errorCode = String(error?.code || '');
      const canFallbackToRedirect = [
        'auth/popup-blocked',
        'auth/operation-not-supported-in-this-environment',
        'auth/web-storage-unsupported',
      ].includes(errorCode);

      if (canFallbackToRedirect) {
        return beginRedirectProviderLinkFlow(provider);
      }

      error.provider = error.provider || providerLabel;
      error.providerId = error.providerId || provider?.providerId || providerId || '';
      markFirebaseSocialAuthRejectedForRuntime(error);
      throw error;
    }
  };

  const signInWithGoogle = async () => signInWithOAuthProvider(googleProvider, 'Google', 'google');
  const signInWithFacebook = async () => signInWithOAuthProvider(facebookProvider, 'Facebook', 'facebook');
  const signInWithGitHub = async () => signInWithOAuthProvider(githubProvider, 'GitHub', 'github');
  const signInWithMicrosoft = async () => signInWithOAuthProvider(microsoftProvider, 'Microsoft', 'microsoft');
  const signInWithApple = async () => signInWithOAuthProvider(appleProvider, 'Apple', 'apple');
  const signInWithX = async () => signInWithOAuthProvider(xProvider, 'X', 'x');
  const linkMicrosoftProvider = async () => linkOAuthProvider(microsoftProvider, 'Microsoft', 'microsoft.com');
  const linkAppleProvider = async () => linkOAuthProvider(appleProvider, 'Apple', 'apple.com');

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
    try {
      await authApi.logoutSession({ firebaseUser: currentUser });
    } catch {
      // best-effort cleanup only
    }

    clearCsrfTokenCache();
    clearAuthJourneyDraft();
    clearRedirectAuthPending();
    setCurrentUser(null);
    applySignedOutState();

    if (!isFirebaseReady || !auth) {
      await signOutNativeSocialAuth();
      return;
    }

    await signOut(auth);
    await signOutNativeSocialAuth();
  };

  const resetBrowserSession = async (options = {}) => {
    const activeUser = currentUser || auth?.currentUser || null;

    return resetBrowserSessionState({
      logoutSession: authApi.logoutSession,
      firebaseAuth: isFirebaseReady ? auth : null,
      firebaseUser: activeUser,
      firebaseSignOut: signOut,
      nativeSignOut: signOutNativeSocialAuth,
      clearRuntimeSession: () => {
        clearCsrfTokenCache();
        clearAuthJourneyDraft();
        clearRedirectAuthPending();
        setCurrentUser(null);
        applySignedOutState();
      },
      ...options,
    });
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
        mfaChallenge: prev.mfaChallenge || null,
        mfaPolicy: prev.mfaPolicy || null,
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
        mfaChallenge: null,
        mfaPolicy: null,
        session: null,
        intelligence: null,
        profile: null,
        roles: EMPTY_ROLES,
        error: {
          message: authIntlRef.current.formatMessage(authContextMessages.bootstrapTimedOut),
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

      refreshSession(user).catch(() => {});
    });

    return () => {
      isMounted = false;
      clearTimeout(bootstrapTimeout);
      unsubscribe();
    };
  }, []);

  const reauthenticateForSensitiveAction = async (options = {}) => {
    const activeUser = currentUser || auth?.currentUser || null;
    if (!activeUser) {
      throw new Error('Sign in again before continuing this protected action.');
    }

    const reauthProvider = getSensitiveActionReauthProvider(activeUser);
    if (!reauthProvider && canUsePasswordReauthProvider(activeUser)) {
      const email = normalizeEmail(activeUser.email || sessionStateRef.current.session?.email || sessionStateRef.current.profile?.email || '');
      const password = String(options?.password || '');

      if (!email || !password) {
        throw buildSensitivePasswordReauthRequiredError(email);
      }

      const credential = EmailAuthProvider.credential(email, password);
      await reauthenticateWithCredential(activeUser, credential);
      if (typeof activeUser?.getIdToken === 'function') {
        await activeUser.getIdToken(true);
      }
      return activeUser;
    }

    if (!reauthProvider) {
      const unsupportedError = new Error(
        'Recent re-authentication is required. Sign out and sign in again, then retry this action.'
      );
      unsupportedError.code = 'auth/requires-recent-login';
      throw unsupportedError;
    }

    assertFirebaseSocialAuthReady(`${reauthProvider.label} re-authentication`);
    if (shouldPreferFirebaseRedirectAuth()) {
      await beginRedirectSensitiveReauthFlow(activeUser, reauthProvider);
    }

    try {
      await reauthenticateWithPopup(activeUser, reauthProvider.provider);
    } catch (error) {
      if (canFallbackToRedirectAuth(error)) {
        await beginRedirectSensitiveReauthFlow(activeUser, reauthProvider);
      }
      markFirebaseSocialAuthRejectedForRuntime(error);
      throw error;
    }

    if (typeof activeUser?.getIdToken === 'function') {
      await activeUser.getIdToken(true);
    }
    return activeUser;
  };

  const runWithFreshSensitiveActionAuth = async (operation) => {
    if (!hasFreshSensitiveActionAuth(sessionState.intelligence)) {
      await reauthenticateForSensitiveAction();
    } else if (typeof currentUser?.getIdToken === 'function') {
      await currentUser.getIdToken(true);
    }

    try {
      return await operation({ forceRefreshAuth: true });
    } catch (error) {
      if (!isRecentReauthRequiredError(error)) {
        throw error;
      }
      await reauthenticateForSensitiveAction();
      return operation({ forceRefreshAuth: true });
    }
  };

  const verifyDeviceChallenge = async (token, proofOrPayload, publicKeySpkiBase64 = '') => {
    const challengePayload = proofOrPayload && typeof proofOrPayload === 'object' && !Array.isArray(proofOrPayload)
      ? proofOrPayload
      : {
        method: 'browser_key',
        proofBase64: proofOrPayload,
        publicKeySpkiBase64,
      };
    const activeUser = currentUser || auth?.currentUser || null;
    const submitChallenge = (options = {}) => authApi.verifyDeviceChallenge(token, challengePayload, '', {
      firebaseUser: activeUser,
      forceRefreshAuth: true,
      ...options,
    });
    let response;
    try {
      response = await submitChallenge();
    } catch (error) {
      if (!isRecentReauthRequiredError(error)) {
        throw error;
      }

      await reauthenticateForSensitiveAction();
      response = await submitChallenge({ forceRefreshAuth: true });
    }

    if (response?.deviceSessionToken) {
      cacheTrustedDeviceSessionToken(response.deviceSessionToken, response.expiresAt);
    }
    if (response.success) {
      if (currentUser && response?.session && response?.profile && response?.roles) {
        const identity = getIdentityKey(
          currentUser,
          response?.session?.email || response?.profile?.email || currentUser?.email || ''
        );
        applyResolvedSession({
          ...response,
          status: SESSION_STATUS.AUTHENTICATED,
          deviceChallenge: null,
          mfaChallenge: null,
          mfaPolicy: null,
          error: null,
        }, currentUser, identity);
      } else {
        setSessionState((prev) => ({
          ...prev,
          status: SESSION_STATUS.AUTHENTICATED,
          deviceChallenge: null,
          mfaChallenge: null,
          mfaPolicy: null,
          error: null,
        }));
      }
    }
    return response;
  };

  const generateRecoveryCodes = async () => {
    if (!currentUser) {
      throw new Error('Sign in before generating recovery codes.');
    }

    const response = await runWithFreshSensitiveActionAuth((authOptions) => (
      authApi.generateRecoveryCodes({ firebaseUser: currentUser, ...authOptions })
    ));
    if (response?.success) {
      refreshSession(currentUser, { force: true, silent: true }).catch(() => {});
    }
    return response;
  };

  const applyMfaSessionResponse = (response) => {
    if (!currentUser || !response?.session || !response?.profile || !response?.roles) {
      return false;
    }

    const identity = getIdentityKey(
      currentUser,
      response?.session?.email || response?.profile?.email || currentUser?.email || ''
    );
    applyResolvedSession({
      ...response,
      status: SESSION_STATUS.AUTHENTICATED,
      deviceChallenge: null,
      mfaChallenge: null,
      mfaPolicy: null,
      error: null,
    }, currentUser, identity);
    return true;
  };

  const refreshMfaSecurityCenter = async () => {
    if (!currentUser) {
      throw new Error('Sign in before loading MFA settings.');
    }

    return authApi.getMfaSecurityCenter({ firebaseUser: currentUser });
  };

  const startTotpSetup = async () => {
    if (!currentUser) {
      throw new Error('Sign in before setting up authenticator MFA.');
    }

    return runWithFreshSensitiveActionAuth((authOptions) => (
      authApi.setupTotp({ firebaseUser: currentUser, ...authOptions })
    ));
  };

  const verifyTotpSetup = async (code) => {
    if (!currentUser) {
      throw new Error('Sign in before verifying authenticator MFA.');
    }

    const response = await runWithFreshSensitiveActionAuth((authOptions) => (
      authApi.verifyTotpSetup(code, { firebaseUser: currentUser, ...authOptions })
    ));
    await refreshSession(currentUser, { force: true, silent: true }).catch(() => {});
    return response;
  };

  const registerMfaPasskey = async () => {
    if (!currentUser) {
      throw new Error('Sign in before registering a passkey.');
    }

    const response = await runWithFreshSensitiveActionAuth((authOptions) => (
      authApi.registerMfaPasskey({ firebaseUser: currentUser, ...authOptions })
    ));
    if (!applyMfaSessionResponse(response)) {
      await refreshSession(currentUser, { force: true, silent: true }).catch(() => {});
    }
    return response;
  };

  const regenerateMfaRecoveryCodes = async () => {
    if (!currentUser) {
      throw new Error('Sign in before regenerating MFA recovery codes.');
    }

    const response = await runWithFreshSensitiveActionAuth((authOptions) => (
      authApi.regenerateMfaRecoveryCodes({ firebaseUser: currentUser, ...authOptions })
    ));
    await refreshSession(currentUser, { force: true, silent: true }).catch(() => {});
    return response;
  };

  const verifyMfaTotpChallenge = async ({ challengeId = '', code = '', purpose = 'login', action = '' } = {}) => {
    if (!currentUser) {
      throw new Error('Sign in before completing MFA.');
    }

    const response = await authApi.verifyTotpLogin({ challengeId, code, purpose, action }, {
      firebaseUser: currentUser,
      useFirebaseBearer: true,
    });
    applyMfaSessionResponse(response);
    return response;
  };

  const verifyMfaPasskeyChallenge = async ({ challengeId = '', purpose = 'login', action = '' } = {}) => {
    if (!currentUser) {
      throw new Error('Sign in before completing MFA.');
    }

    const response = await authApi.verifyMfaPasskeyLogin({ challengeId, purpose, action }, {
      firebaseUser: currentUser,
      useFirebaseBearer: true,
    });
    applyMfaSessionResponse(response);
    return response;
  };

  const verifyMfaRecoveryCodeChallenge = async ({ challengeId = '', code = '', purpose = 'login', action = '' } = {}) => {
    if (!currentUser) {
      throw new Error('Sign in before completing MFA.');
    }

    const response = await authApi.verifyMfaRecoveryCode({ challengeId, code, purpose, action }, {
      firebaseUser: currentUser,
      useFirebaseBearer: true,
    });
    applyMfaSessionResponse(response);
    return response;
  };

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
    mfaChallenge: sessionState.mfaChallenge,
    mfaPolicy: sessionState.mfaPolicy,
    sessionError: sessionState.error,
    loading: sessionState.status === SESSION_STATUS.BOOTSTRAP || sessionState.status === SESSION_STATUS.LOADING,
    isAuthenticated,
    signup,
    login,
    loginWithPhoneCredential,
    signInWithGoogle,
    signInWithFacebook,
    signInWithGitHub,
    signInWithMicrosoft,
    signInWithApple,
    signInWithX,
    signInWithEnterprise,
    signInWithDesktopBrowser,
    signInWithDesktopOwnerAccess,
    linkMicrosoftProvider,
    linkAppleProvider,
    logout,
    resetBrowserSession,
    refreshSession,
    syncUserWithBackend,
    updatePhone,
    updateProfile: updateProfileInBackend,
    activateSeller,
    deactivateSeller,
    reauthenticateForSensitiveAction,
    verifyDeviceChallenge,
    generateRecoveryCodes,
    refreshMfaSecurityCenter,
    startTotpSetup,
    verifyTotpSetup,
    registerMfaPasskey,
    regenerateMfaRecoveryCodes,
    verifyMfaTotpChallenge,
    verifyMfaPasskeyChallenge,
    verifyMfaRecoveryCodeChallenge,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
