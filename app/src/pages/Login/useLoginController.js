import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
import { useMarket } from '@/context/MarketContext';
import { getPhoneCountryOption, getPhoneCountryOptionLabel, PHONE_COUNTRY_OPTIONS } from '@/config/phoneCountryOptions';
import { authApi, otpApi } from '@/services/api';
import { cacheTrustedDeviceSessionToken } from '@/services/deviceTrustClient';
import {
  completeFirebasePhoneCodeChallenge,
  completeFirebasePhoneLoginChallenge,
  disposeFirebasePhoneLoginChallenge,
  startFirebasePhoneCodeChallenge,
  startFirebasePhoneLoginChallenge,
} from '@/services/firebasePhoneChallenge';
import {
  clearAuthJourneyDraft,
  describeAccelerationLane,
  readAuthIdentityMemory,
  readAuthJourneyDraft,
  writeAuthJourneyDraft,
} from '@/utils/authAcceleration';
import { resolveAuthError, resolveAuthSuccess } from '@/utils/authErrors';
import { resolveFirebasePhoneFallback } from '@/utils/firebasePhoneFallback';
import { resolveNavigationTarget } from '@/utils/navigation';
import { verifyCredentialsWithoutSession } from '@/utils/precheckCredentials';
import { getFirebaseSocialAuthStatus } from '@/config/firebase';
import { isTurnstileEnabled } from '@/services/turnstileClient';
import {
  buildGenericOtpFlowError,
  buildInternationalPhoneNumber,
  createEmptyFormData,
  createEmptyOtpValues,
  getPhoneNationalInputValue,
  getAuthPurpose,
  isEnumerationSensitiveOtpError,
  normalizeEmail,
  OTP_LENGTH,
  OTP_STAGE,
  OTP_TRANSPORT,
  resolvePhoneCountryCode,
  resolveSubmitPhone,
  resolveLaunchMode,
  resolveLaunchPrefill,
  shouldKeepSpecificOtpError,
  validateEmail,
  validatePhone,
} from './loginFlowHelpers';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';

const formatProviderList = (providers = []) => {
  const safeProviders = providers.filter(Boolean);
  if (safeProviders.length <= 2) return safeProviders.join(' and ');

  return `${safeProviders.slice(0, -1).join(', ')}, and ${safeProviders.at(-1)}`;
};

const DESKTOP_AUTH_REQUEST_PARAM = 'desktopAuthRequest';
const DESKTOP_AUTH_SECRET_PARAM = 'desktopAuthSecret';
const DESKTOP_AUTH_RETURN_TO_PARAM = 'desktopAuthReturnTo';
const DESKTOP_AUTH_CALLBACK_PARAM = 'desktopAuthCallback';
const DESKTOP_AUTH_TRANSPORT_PARAM = 'desktopAuthTransport';
const DESKTOP_AUTH_FORM_TRANSPORT = 'form_post';
const DESKTOP_AUTH_SENSITIVE_PARAMS = [
  DESKTOP_AUTH_SECRET_PARAM,
  DESKTOP_AUTH_RETURN_TO_PARAM,
  DESKTOP_AUTH_CALLBACK_PARAM,
  DESKTOP_AUTH_TRANSPORT_PARAM,
];
const DESKTOP_AUTH_COMPLETE_PATH = '/desktop-auth/complete';
const DESKTOP_AUTH_CANCEL_PATH = '/desktop-auth/cancel';
const DESKTOP_AUTH_HANDOFF_STORAGE_KEY = 'aura_desktop_auth_handoff_v1';
const DESKTOP_AUTH_HANDOFF_STORAGE_TTL_MS = 10 * 60 * 1000;
const DESKTOP_AUTH_CALLBACK_HOST = '127.0.0.1';
const DESKTOP_AUTH_CALLBACK_UNREACHABLE_MESSAGE = 'Aura Desktop is not reachable at the local sign-in bridge. Keep Aura Desktop open, start a fresh desktop sign-in, and try again.';

const normalizeDesktopAuthLoopbackHost = (hostname = '') => {
  switch (String(hostname || '').trim().toLowerCase()) {
    case 'localhost':
    case '127.0.0.1':
      return DESKTOP_AUTH_CALLBACK_HOST;
    case '::1':
    case '[::1]':
      return DESKTOP_AUTH_CALLBACK_HOST;
    default:
      return '';
  }
};

const normalizeDesktopAuthCallbackPort = (port = '') => {
  switch (String(port || '').trim()) {
    case '47831':
    case '47832':
    case '47833':
    case '47834':
    case '47835':
    case '47836':
    case '47837':
    case '47838':
    case '47839':
    case '47840':
    case '47841':
      return String(port).trim();
    default:
      return '';
  }
};

const buildLoopbackDesktopAuthCallbackUrl = (hostname = '', port = '') => {
  const trustedHost = normalizeDesktopAuthLoopbackHost(hostname);
  const trustedPort = normalizeDesktopAuthCallbackPort(port);
  return trustedHost && trustedPort
    ? `http://${trustedHost}:${trustedPort}${DESKTOP_AUTH_COMPLETE_PATH}`
    : '';
};
const TERMINAL_RESET_GRANT_MESSAGES = [
  'login assurance token expired',
  'login assurance token already used',
  'login assurance token was superseded',
  'login assurance token purpose mismatch',
  'login assurance token factor mismatch',
  'login assurance token next step mismatch',
  'login assurance token is invalid',
  'password reset verification is required before setting a new password',
  'password reset verification expired',
  'secure recovery token expired',
];

const isTerminalResetGrantError = (error) => {
  const status = Number(error?.status || error?.data?.statusCode || error?.data?.status || 0);
  const message = [
    error?.message,
    error?.data?.message,
    error?.detail,
  ].map((value) => String(value || '').toLowerCase()).join(' ');

  if (message.includes('login assurance token is already being used')) {
    return false;
  }

  return TERMINAL_RESET_GRANT_MESSAGES.some((pattern) => message.includes(pattern))
    || status === 409;
};

const isResetPasswordRateLimitError = (error) => (
  Number(error?.status || error?.data?.statusCode || error?.data?.status || 0) === 429
);

const DESKTOP_AUTH_REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{1,200}$/;
const PROTOTYPE_SENSITIVE_REQUEST_IDS = new Set(['__proto__', 'constructor', 'prototype']);

const parseBooleanEnv = (value, fallback = false) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const isDuoLoginEnabled = parseBooleanEnv(import.meta.env.VITE_DUO_LOGIN_ENABLED, false);

export const normalizeDesktopAuthCallbackUrl = (value = '') => {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return '';
  }

  try {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const url = new URL(rawValue, baseUrl);
    const isRelativeCallback = !/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(rawValue);

    if (isRelativeCallback && url.pathname === DESKTOP_AUTH_COMPLETE_PATH) {
      return DESKTOP_AUTH_COMPLETE_PATH;
    }

    const callbackPort = url.port || (url.protocol === 'http:' ? '80' : '');
    if (url.protocol === 'http:' && url.pathname === DESKTOP_AUTH_COMPLETE_PATH) {
      return buildLoopbackDesktopAuthCallbackUrl(url.hostname, callbackPort);
    }
  } catch {
    // Invalid callback URLs are rejected by returning an empty callback.
  }

  return '';
};

export const submitDesktopBrowserHandoffForm = ({ callbackUrl, requestId, secret, customToken } = {}) => {
  if (typeof document === 'undefined' || !document.body) {
    throw new Error(DESKTOP_AUTH_CALLBACK_UNREACHABLE_MESSAGE);
  }

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = callbackUrl;
  form.style.display = 'none';

  Object.entries({ requestId, secret, customToken }).forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = String(value || '');
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
};

export const buildDesktopAuthCancelUrl = (callbackUrl = '') => {
  const normalizedCallbackUrl = normalizeDesktopAuthCallbackUrl(callbackUrl);
  if (!normalizedCallbackUrl) {
    return '';
  }
  if (normalizedCallbackUrl === DESKTOP_AUTH_COMPLETE_PATH) {
    return DESKTOP_AUTH_CANCEL_PATH;
  }

  const cancelUrl = new URL(normalizedCallbackUrl);
  cancelUrl.pathname = DESKTOP_AUTH_CANCEL_PATH;
  cancelUrl.search = '';
  cancelUrl.hash = '';
  return cancelUrl.toString();
};

export const submitDesktopBrowserHandoffCancellation = ({ callbackUrl, requestId, secret } = {}) => {
  const cancelUrl = buildDesktopAuthCancelUrl(callbackUrl);
  if (!cancelUrl || typeof document === 'undefined' || !document.body) {
    throw new Error(DESKTOP_AUTH_CALLBACK_UNREACHABLE_MESSAGE);
  }

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = cancelUrl;
  form.style.display = 'none';

  Object.entries({ requestId, secret }).forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = String(value || '');
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
};

const postLegacyDesktopBrowserHandoff = async ({ callbackUrl, requestId, secret, customToken } = {}) => {
  let response;
  try {
    response = await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, secret, customToken }),
    });
  } catch {
    throw new Error(DESKTOP_AUTH_CALLBACK_UNREACHABLE_MESSAGE);
  }

  if (!response.ok) {
    let message = 'Desktop sign-in could not be completed.';
    try {
      const payload = await response.json();
      message = payload?.message || message;
    } catch {
      // Keep the generic message.
    }
    throw new Error(message);
  }
};

const getDesktopAuthStorage = () => {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // Session storage can be blocked by hardened browser settings.
  }
  return null;
};

const normalizeDesktopAuthRequestId = (value = '') => {
  const requestId = String(value || '').trim();
  return DESKTOP_AUTH_REQUEST_ID_PATTERN.test(requestId) && !PROTOTYPE_SENSITIVE_REQUEST_IDS.has(requestId)
    ? requestId
    : '';
};

const readDesktopAuthStorageMap = () => {
  const storage = getDesktopAuthStorage();
  if (!storage) return new Map();

  try {
    const parsed = JSON.parse(storage.getItem(DESKTOP_AUTH_HANDOFF_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? new Map(Object.entries(parsed))
      : new Map();
  } catch {
    storage.removeItem(DESKTOP_AUTH_HANDOFF_STORAGE_KEY);
    return new Map();
  }
};

const writeDesktopAuthStorageMap = (value = new Map()) => {
  const storage = getDesktopAuthStorage();
  if (!storage) return false;

  try {
    storage.setItem(DESKTOP_AUTH_HANDOFF_STORAGE_KEY, JSON.stringify(Object.fromEntries(value)));
    return true;
  } catch {
    return false;
  }
};

export const clearStoredDesktopBrowserHandoff = (requestId = '') => {
  const normalizedRequestId = normalizeDesktopAuthRequestId(requestId);
  if (!normalizedRequestId) return;

  const stored = readDesktopAuthStorageMap();
  if (!stored.has(normalizedRequestId)) return;
  stored.delete(normalizedRequestId);
  writeDesktopAuthStorageMap(stored);
};

export const persistDesktopBrowserHandoff = (handoff = {}) => {
  const requestId = normalizeDesktopAuthRequestId(handoff.requestId);
  const secret = String(handoff.secret || '').trim();
  const callbackUrl = normalizeDesktopAuthCallbackUrl(handoff.callbackUrl);
  if (!requestId || !secret || !callbackUrl) {
    return false;
  }

  const stored = readDesktopAuthStorageMap();
  stored.set(requestId, {
    requestId,
    secret,
    callbackUrl,
    returnTo: resolveNavigationTarget(handoff.returnTo, '/'),
    transport: handoff.transport === DESKTOP_AUTH_FORM_TRANSPORT ? DESKTOP_AUTH_FORM_TRANSPORT : '',
    expiresAt: Date.now() + DESKTOP_AUTH_HANDOFF_STORAGE_TTL_MS,
  });
  return writeDesktopAuthStorageMap(stored);
};

const readStoredDesktopBrowserHandoff = (requestId = '') => {
  const normalizedRequestId = normalizeDesktopAuthRequestId(requestId);
  if (!normalizedRequestId) return null;

  const stored = readDesktopAuthStorageMap();
  const entry = stored.get(normalizedRequestId);
  if (!entry || typeof entry !== 'object') return null;

  if (Number(entry.expiresAt || 0) <= Date.now()) {
    stored.delete(normalizedRequestId);
    writeDesktopAuthStorageMap(stored);
    return null;
  }

  const callbackUrl = normalizeDesktopAuthCallbackUrl(entry.callbackUrl);
  const secret = String(entry.secret || '').trim();
  if (!secret || !callbackUrl) return null;

  return {
    requestId: normalizedRequestId,
    secret,
    callbackUrl,
    returnTo: resolveNavigationTarget(entry.returnTo, '/'),
    transport: entry.transport === DESKTOP_AUTH_FORM_TRANSPORT ? DESKTOP_AUTH_FORM_TRANSPORT : '',
  };
};

export const buildDesktopDuoReturnTo = (requestId = '') => {
  const normalizedRequestId = normalizeDesktopAuthRequestId(requestId);
  if (!normalizedRequestId) return '/desktop-login';

  const params = new URLSearchParams();
  params.set(DESKTOP_AUTH_REQUEST_PARAM, normalizedRequestId);
  return `/desktop-login?${params.toString()}`;
};

const buildDesktopAuthFragmentParams = (hash = '') => (
  new URLSearchParams(String(hash || '').replace(/^#/, ''))
);

const hasInlineDesktopBrowserHandoff = (search = '', hash = '') => {
  const searchParams = new URLSearchParams(search || '');
  const fragmentParams = buildDesktopAuthFragmentParams(hash);
  return DESKTOP_AUTH_SENSITIVE_PARAMS.some((name) => (
    searchParams.has(name) || fragmentParams.has(name)
  ));
};

const stripInlineDesktopBrowserHandoff = ({ pathname = '/', search = '', hash = '' } = {}) => {
  const searchParams = new URLSearchParams(search || '');
  DESKTOP_AUTH_SENSITIVE_PARAMS.forEach((name) => searchParams.delete(name));

  const fragmentParams = buildDesktopAuthFragmentParams(hash);
  const hasSensitiveFragment = DESKTOP_AUTH_SENSITIVE_PARAMS.some((name) => fragmentParams.has(name));
  if (hasSensitiveFragment) {
    DESKTOP_AUTH_SENSITIVE_PARAMS.forEach((name) => fragmentParams.delete(name));
  }

  const sanitizedSearch = searchParams.toString();
  const sanitizedFragment = fragmentParams.toString();
  return {
    pathname: pathname || '/',
    search: sanitizedSearch ? `?${sanitizedSearch}` : '',
    hash: hasSensitiveFragment
      ? (sanitizedFragment ? `#${sanitizedFragment}` : '')
      : hash,
  };
};

export const resolveDesktopBrowserHandoff = (search = '', hash = '') => {
  const params = new URLSearchParams(search || '');
  const fragmentParams = buildDesktopAuthFragmentParams(hash);
  const getInlineValue = (name) => fragmentParams.get(name) || params.get(name);
  const requestId = String(params.get(DESKTOP_AUTH_REQUEST_PARAM) || '').trim();
  const stored = readStoredDesktopBrowserHandoff(requestId);
  const secret = String(getInlineValue(DESKTOP_AUTH_SECRET_PARAM) || stored?.secret || '').trim();
  const inlineReturnTo = getInlineValue(DESKTOP_AUTH_RETURN_TO_PARAM);
  const returnTo = inlineReturnTo
    ? resolveNavigationTarget(inlineReturnTo, '/')
    : resolveNavigationTarget(stored?.returnTo, '/');
  const callbackUrl = normalizeDesktopAuthCallbackUrl(getInlineValue(DESKTOP_AUTH_CALLBACK_PARAM))
    || stored?.callbackUrl
    || '';
  const transport = getInlineValue(DESKTOP_AUTH_TRANSPORT_PARAM) || stored?.transport || '';

  return {
    active: Boolean(requestId && secret),
    callbackUrl,
    requestId,
    secret,
    transport: transport === DESKTOP_AUTH_FORM_TRANSPORT ? DESKTOP_AUTH_FORM_TRANSPORT : '',
    returnTo,
  };
};

const normalizeSocialAuthError = (error, providerLabel = 'Social', socialAuthStatus = null) => {
  const errorCode = String(error?.code || '').trim();
  const errorMessage = String(error?.message || '').trim();
  const errorStatus = Number(error?.status || error?.data?.statusCode || 0);
  const normalizedMessage = errorMessage.toLowerCase();
  const normalizedError = {
    ...error,
    ...(errorCode ? { code: errorCode } : {}),
    ...(errorMessage ? { message: errorMessage } : {}),
    ...(errorStatus ? { status: errorStatus } : {}),
    provider: error?.provider || providerLabel,
    host: error?.host || socialAuthStatus?.runtimeHost || '',
  };

  if (errorCode === 'auth/invalid-credential') {
    return {
      ...normalizedError,
      code: 'auth/social-invalid-credential',
      provider: providerLabel,
      originalCode: errorCode,
      message: errorMessage || `${providerLabel} authentication could not be completed.`,
    };
  }

  if (errorCode === 'auth/account-exists-with-different-credential') {
    return {
      ...normalizedError,
      provider: providerLabel,
      email: error?.email || error?.customData?.email || '',
    };
  }

  if (
    errorMessage.toLowerCase().includes('did not provide an email')
    || errorMessage.toLowerCase().includes('authenticated account is missing email')
  ) {
    return {
      ...normalizedError,
      code: 'auth/social-email-missing',
      provider: providerLabel,
    };
  }

  if (
    errorStatus >= 500
    && (
      normalizedMessage.includes('something went wrong')
      || normalizedMessage.includes('request failed with status 500')
    )
  ) {
    return {
      ...normalizedError,
      code: 'auth/social-session-sync-failed',
      provider: providerLabel,
      originalStatus: errorStatus,
      requestId: error?.serverRequestId || error?.requestId || error?.data?.requestId || '',
      message: errorMessage || `${providerLabel} authenticated, but Aura could not finish opening your session.`,
    };
  }

  if (errorCode === 'auth/popup-closed-by-user') {
    return {
      ...normalizedError,
      provider: providerLabel,
      message: errorMessage || `${providerLabel} sign-in was cancelled before completion.`,
    };
  }

  return normalizedError;
};

export const useLoginController = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { countryCode: marketCountryCode, t: legacyT } = useMarket();
  const t = useStableIcuMessages(legacyT);
  const authAccelerationIntl = useMemo(() => ({
    formatMessage: (descriptor = {}) => t(descriptor.id, {}, descriptor.defaultMessage || ''),
  }), [t]);
  const launchMode = resolveLaunchMode(location.state?.authMode);
  const launchPrefill = resolveLaunchPrefill(location.state);
  const {
    currentUser,
    isAuthenticated,
    login,
    loginWithPhoneCredential,
    loading,
    status: sessionStatus,
    signup,
    signInWithGoogle,
    signInWithFacebook,
    signInWithGitHub,
    signInWithMicrosoft,
    signInWithApple,
    signInWithX,
    signInWithDesktopBrowser,
    reopenDesktopBrowserSignIn,
    signInWithDesktopOwnerAccess,
    logout,
    roles,
    session,
  } = useContext(AuthContext);

  const [mode, setMode] = useState(launchMode);
  const [step, setStep] = useState('form');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authSuccess, setAuthSuccess] = useState(null);
  const [pendingAuthSuccess, setPendingAuthSuccess] = useState(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileRefreshKey, setTurnstileRefreshKey] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [signInProofToken, setSignInProofToken] = useState('');
  const [loginFlowToken, setLoginFlowToken] = useState('');
  const [otpTransport, setOtpTransport] = useState(OTP_TRANSPORT.BACKEND_OTP);
  const [otpStage, setOtpStage] = useState(OTP_STAGE.SINGLE);
  const [firebasePhoneFallback, setFirebasePhoneFallback] = useState(null);
  const [resumeDraft, setResumeDraft] = useState(null);
  const [identityMemory, setIdentityMemory] = useState(null);
  const [desktopOwnerAccessAvailable, setDesktopOwnerAccessAvailable] = useState(false);
  const [desktopBrowserSignInPending, setDesktopBrowserSignInPending] = useState(false);
  const [desktopBrowserRequestId, setDesktopBrowserRequestId] = useState('');
  const [desktopBrowserConsentGrantedKey, setDesktopBrowserConsentGrantedKey] = useState('');
  const [desktopBrowserConsentSubmitting, setDesktopBrowserConsentSubmitting] = useState(false);
  const [desktopBrowserConsentStage, setDesktopBrowserConsentStage] = useState('idle');
  const [desktopBrowserHandoffPreflight, setDesktopBrowserHandoffPreflight] = useState(null);
  const [desktopBrowserHandoffPreflightReadyKey, setDesktopBrowserHandoffPreflightReadyKey] = useState('');
  const [desktopBrowserHandoffPreflightFailed, setDesktopBrowserHandoffPreflightFailed] = useState(false);
  const [desktopBrowserCookieSession, setDesktopBrowserCookieSession] = useState(null);
  const [desktopBrowserCookieSessionLoading, setDesktopBrowserCookieSessionLoading] = useState(false);
  const [formData, setFormData] = useState(() => createEmptyFormData({
    email: launchPrefill.email,
    phone: launchPrefill.phone,
  }));
  const [phoneCountryCode, setPhoneCountryCode] = useState(() => (
    resolvePhoneCountryCode(launchPrefill.phone, marketCountryCode)
  ));
  const [otpValues, setOtpValues] = useState(createEmptyOtpValues);

  const otpRefs = useRef([]);
  const recaptchaContainerRef = useRef(null);
  const firebasePhoneChallengeRef = useRef(null);
  const authAccelerationHydratedRef = useRef(false);
  const initialResolvedAuthRedirectCheckedRef = useRef(false);
  const authenticatedNavigationTimerRef = useRef(null);
  const pendingAuthDestinationRef = useRef('');
  const desktopBrowserHandoffCompletedRef = useRef(null);
  const desktopBrowserHandoffKeyRef = useRef('');
  const desktopBrowserHandoffPreflightAttemptRef = useRef('');
  const desktopBrowserAbortControllerRef = useRef(null);
  const resetPasswordRequestInFlightRef = useRef(false);

  const from = useMemo(
    () => resolveNavigationTarget(location.state?.from, '/'),
    [location.state?.from]
  );
  const currentRoute = useMemo(
    () => `${location.pathname || '/'}${location.search || ''}${location.hash || ''}`,
    [location.hash, location.pathname, location.search]
  );
  const desktopBrowserHandoff = useMemo(
    () => resolveDesktopBrowserHandoff(location.search, location.hash),
    [location.hash, location.search]
  );
  const desktopBrowserHandoffKey = useMemo(
    () => (
      desktopBrowserHandoff.active
        ? `${desktopBrowserHandoff.requestId}:${desktopBrowserHandoff.secret}`
        : ''
    ),
    [desktopBrowserHandoff.active, desktopBrowserHandoff.requestId, desktopBrowserHandoff.secret]
  );
  desktopBrowserHandoffKeyRef.current = desktopBrowserHandoffKey;
  const desktopBrowserHandoffIsInline = useMemo(
    () => hasInlineDesktopBrowserHandoff(location.search, location.hash),
    [location.hash, location.search]
  );
  const duoCallbackStatus = useMemo(
    () => String(new URLSearchParams(location.search || '').get('duo') || '').trim().toLowerCase(),
    [location.search]
  );
  const duoReturnTo = useMemo(
    () => (desktopBrowserHandoff.active ? currentRoute : from),
    [currentRoute, desktopBrowserHandoff.active, from]
  );
  const desktopBrowserCookieSessionRequired = Boolean(
    desktopBrowserHandoff.active
    && (duoCallbackStatus === 'success' || duoCallbackStatus === 'step-up')
  );
  const desktopBrowserResolvedRoles = desktopBrowserCookieSessionRequired
    ? desktopBrowserCookieSession?.roles
    : roles;
  const desktopBrowserResolvedSession = desktopBrowserCookieSessionRequired
    ? desktopBrowserCookieSession?.session
    : session;
  const desktopBrowserConsentGranted = Boolean(
    desktopBrowserHandoffKey
    && desktopBrowserConsentGrantedKey === desktopBrowserHandoffKey
  );
  const desktopBrowserHandoffCheckpoint = (
    desktopBrowserHandoffPreflight?.status === 'device_challenge_required'
    || desktopBrowserHandoffPreflight?.status === 'mfa_challenge_required'
    || desktopBrowserHandoffPreflight?.mfaBlocked === true
  )
    ? desktopBrowserHandoffPreflight
    : null;
  const desktopBrowserConsentReady = Boolean(
    desktopBrowserHandoff.active
    && !loading
    && !desktopBrowserCookieSessionLoading
    && !desktopBrowserConsentGranted
    && !desktopBrowserHandoffCheckpoint
    && desktopBrowserHandoffPreflightReadyKey === desktopBrowserHandoffKey
    && (
      (
        desktopBrowserCookieSessionRequired
        && desktopBrowserCookieSession?.status === 'authenticated'
      )
      || (
        !desktopBrowserCookieSessionRequired
        && isAuthenticated
        && currentUser?.getIdToken
      )
    )
  );
  const desktopBrowserSessionHydrating = Boolean(
    desktopBrowserHandoff.active
    && (loading || desktopBrowserCookieSessionLoading)
  );
  const desktopBrowserConsentActionLabel = t('common.action.continue', {}, 'Continue');
  const desktopBrowserConsentSubmittingLabel = desktopBrowserConsentStage === 'preflight'
    ? t('desktopLogin.consent.checkingDevice', {}, 'Checking this browser')
    : t('desktopLogin.consent.submitting', {}, 'Opening Aura Desktop');
  const desktopBrowserConsentIdentity = String(
    (desktopBrowserCookieSessionRequired
      ? (
        desktopBrowserCookieSession?.session?.email
        || desktopBrowserCookieSession?.profile?.email
      )
      : currentUser?.email)
    || t('desktopLogin.consent.verifiedAccount', {}, 'Verified Aura account')
  ).trim();
  const hasLaunchDirective = Boolean(location.state?.authMode || launchPrefill.email || launchPrefill.phone);
  const socialAuthStatus = getFirebaseSocialAuthStatus();
  useEffect(() => {
    let cancelled = false;

    if (!socialAuthStatus.runtimeElectronDesktop) {
      setDesktopOwnerAccessAvailable(false);
      return () => {
        cancelled = true;
      };
    }

    const desktop = typeof window !== 'undefined' ? window.auraDesktop : null;
    if (!desktop?.isDesktop || typeof desktop.getAppInfo !== 'function') {
      setDesktopOwnerAccessAvailable(false);
      return () => {
        cancelled = true;
      };
    }

    desktop.getAppInfo()
      .then((info) => {
        if (!cancelled) {
          setDesktopOwnerAccessAvailable(Boolean(info?.ownerAccessSignInAvailable));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDesktopOwnerAccessAvailable(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [socialAuthStatus.runtimeElectronDesktop]);

  const canUseDesktopBrowserSignIn = Boolean(
    socialAuthStatus.runtimeElectronDesktop
    && typeof signInWithDesktopBrowser === 'function'
  );
  const canUseDesktopOwnerAccessSignIn = Boolean(
    socialAuthStatus.runtimeElectronDesktop
    && desktopOwnerAccessAvailable
    && typeof signInWithDesktopOwnerAccess === 'function'
  );
  const canUseMobileFirebasePhoneOtp = !socialAuthStatus.runtimeCapacitorMobile
    || socialAuthStatus.mobileFirebasePhoneOtpEnabled;
  const canUseFirebasePhoneOtp = step !== 'reset-password'
    && socialAuthStatus.ready
    && !firebasePhoneFallback?.disableFirebasePhoneOtp
    && canUseMobileFirebasePhoneOtp;
  const isEmailOtpStage = otpStage === OTP_STAGE.EMAIL;
  const isPhoneOtpStage = otpStage === OTP_STAGE.PHONE;
  const selectedPhoneCountry = useMemo(
    () => getPhoneCountryOption(phoneCountryCode),
    [phoneCountryCode]
  );
  const phoneCountryOptions = useMemo(
    () => PHONE_COUNTRY_OPTIONS.map((option) => ({
      ...option,
      label: getPhoneCountryOptionLabel(option),
    })),
    []
  );
  const phoneLocalValue = useMemo(
    () => getPhoneNationalInputValue(formData.phone, phoneCountryCode),
    [formData.phone, phoneCountryCode]
  );
  const currentPhoneE164 = useMemo(
    () => resolveSubmitPhone(formData.phone, phoneCountryCode),
    [formData.phone, phoneCountryCode]
  );

  const setErr = (rawErr) => setAuthError(resolveAuthError(rawErr, t));
  const turnstileEnabled = isTurnstileEnabled();

  const getDesktopBrowserHandoffAuthOptions = useCallback(() => (
    desktopBrowserCookieSessionRequired
      ? { preferCookieSession: true }
      : { firebaseUser: currentUser }
  ), [currentUser, desktopBrowserCookieSessionRequired]);

  const cacheDesktopBrowserTrustedDeviceSession = useCallback((payload) => {
    if (payload?.deviceSessionToken) {
      cacheTrustedDeviceSessionToken(payload.deviceSessionToken, payload.expiresAt);
    }
    if (desktopBrowserCookieSessionRequired && payload?.session) {
      setDesktopBrowserCookieSession(payload);
    }
  }, [desktopBrowserCookieSessionRequired]);

  const runDesktopBrowserHandoffPreflight = useCallback(async ({ handoffKey = desktopBrowserHandoffKey } = {}) => {
    if (!desktopBrowserHandoff.active || !handoffKey) {
      throw new Error('The desktop sign-in request is no longer active. Start again from Aura Desktop.');
    }

    const payload = await authApi.prepareDesktopHandoff({
      requestId: desktopBrowserHandoff.requestId,
      ...getDesktopBrowserHandoffAuthOptions(),
    });
    if (desktopBrowserHandoffKeyRef.current !== handoffKey) {
      return payload;
    }

    cacheDesktopBrowserTrustedDeviceSession(payload);
    const status = String(payload?.status || '').trim().toLowerCase();
    if (payload?.handoffReady === true || status === 'handoff_ready') {
      setDesktopBrowserHandoffPreflight(null);
      setDesktopBrowserHandoffPreflightFailed(false);
      setDesktopBrowserHandoffPreflightReadyKey(handoffKey);
      return payload;
    }

    if (
      status === 'device_challenge_required'
      || status === 'mfa_challenge_required'
      || payload?.mfaBlocked === true
    ) {
      setDesktopBrowserHandoffPreflight(payload);
      setDesktopBrowserHandoffPreflightFailed(false);
      setDesktopBrowserHandoffPreflightReadyKey('');
      return payload;
    }

    throw new Error('Aura could not confirm this browser for the desktop handoff. Start a fresh desktop sign-in and try again.');
  }, [
    cacheDesktopBrowserTrustedDeviceSession,
    desktopBrowserHandoff.active,
    desktopBrowserHandoff.requestId,
    desktopBrowserHandoffKey,
    getDesktopBrowserHandoffAuthOptions,
  ]);

  const completeDesktopBrowserHandoff = useCallback(async ({
    firebaseUser = null,
    preferCookieSession = false,
    isCancelled = () => false,
  } = {}) => {
    const handoffKey = `${desktopBrowserHandoff.requestId}:${desktopBrowserHandoff.secret}`;
    if (desktopBrowserHandoffCompletedRef.current?.key === handoffKey) {
      return;
    }

    const handoffAttempt = { key: handoffKey };
    desktopBrowserHandoffCompletedRef.current = handoffAttempt;
    setIsLoading(true);
    setAuthError(null);
    setDesktopBrowserConsentStage('handoff');
    setAuthSuccess({
      title: t('login.desktopBrowser.completingTitle', {}, 'Finishing Desktop Sign-In'),
      detail: t('login.desktopBrowser.completingDetail', {}, 'Aura is securely returning this browser sign-in to the desktop app.'),
    });

    try {
      const callbackUrl = normalizeDesktopAuthCallbackUrl(desktopBrowserHandoff.callbackUrl);
      if (!callbackUrl) {
        throw new Error('Desktop sign-in callback is not trusted.');
      }

      const tokenPayload = await authApi.createDesktopHandoffToken({
        firebaseUser,
        requestId: desktopBrowserHandoff.requestId,
        ...(preferCookieSession ? { preferCookieSession: true } : {}),
      });
      if (isCancelled()) {
        if (desktopBrowserHandoffCompletedRef.current === handoffAttempt) {
          desktopBrowserHandoffCompletedRef.current = null;
        }
        return;
      }
      const customToken = String(tokenPayload?.customToken || '').trim();
      if (!customToken) {
        throw new Error('Desktop sign-in token was not returned by the server.');
      }

      if (desktopBrowserHandoff.transport === DESKTOP_AUTH_FORM_TRANSPORT) {
        // Use a top-level loopback navigation. Public HTTPS pages can require Local Network Access
        // permission for fetch/subresource requests, while native-app loopback redirects use navigation.
        clearStoredDesktopBrowserHandoff(desktopBrowserHandoff.requestId);
        submitDesktopBrowserHandoffForm({
          callbackUrl,
          requestId: desktopBrowserHandoff.requestId,
          secret: desktopBrowserHandoff.secret,
          customToken,
        });
      } else {
        // Keep older desktop releases working while the new form transport rolls out.
        await postLegacyDesktopBrowserHandoff({
          callbackUrl,
          requestId: desktopBrowserHandoff.requestId,
          secret: desktopBrowserHandoff.secret,
          customToken,
        });
        clearStoredDesktopBrowserHandoff(desktopBrowserHandoff.requestId);
      }
    } catch (error) {
      if (desktopBrowserHandoffCompletedRef.current === handoffAttempt) {
        desktopBrowserHandoffCompletedRef.current = null;
      }
      if (!isCancelled()) {
        setDesktopBrowserConsentGrantedKey('');
        setDesktopBrowserConsentSubmitting(false);
        setDesktopBrowserConsentStage('idle');
        setDesktopBrowserHandoffPreflightReadyKey('');
        setDesktopBrowserHandoffPreflightFailed(true);
        setAuthSuccess(null);
        setAuthError(resolveAuthError(error, t));
      }
    } finally {
      if (!isCancelled()) {
        setIsLoading(false);
      }
    }
  }, [
    desktopBrowserHandoff.callbackUrl,
    desktopBrowserHandoff.requestId,
    desktopBrowserHandoff.secret,
    desktopBrowserHandoff.transport,
    t,
  ]);

  const refreshTurnstile = useCallback(() => {
    setTurnstileToken('');
    setTurnstileRefreshKey((value) => value + 1);
  }, []);

  const handleTurnstileToken = useCallback((token) => {
    setTurnstileToken(String(token || '').trim());
  }, []);

  const handleTurnstileError = useCallback(() => {
    setTurnstileToken('');
  }, []);

  const getTurnstileTokenForRequest = () => {
    if (!turnstileEnabled) return '';
    const token = String(turnstileToken || '').trim();
    if (token) return token;
    throw new Error(t('login.error.turnstileRequired', {}, 'Security check is still loading. Please try again.'));
  };

  const buildTurnstileRequestOptions = (options = {}) => {
    const token = getTurnstileTokenForRequest();
    return token ? { ...options, turnstileToken: token } : options;
  };

  const clearAuthFeedback = () => {
    setAuthError(null);
    setAuthSuccess(null);
  };

  const resetOtpFlowState = ({ resetCountdown = true, preserveFlowToken = false } = {}) => {
    if (resetCountdown) {
      setCountdown(0);
    }
    setOtpValues(createEmptyOtpValues());
    setSignInProofToken('');
    if (!preserveFlowToken) {
      setLoginFlowToken('');
    }
    setOtpStage(OTP_STAGE.SINGLE);
    setOtpTransport(OTP_TRANSPORT.BACKEND_OTP);
  };

  const clearFirebaseChallenge = async () => {
    const activeChallenge = firebasePhoneChallengeRef.current;
    firebasePhoneChallengeRef.current = null;

    if (!activeChallenge) return;
    await disposeFirebasePhoneLoginChallenge(activeChallenge);
  };

  const resetToFormStep = ({ resetFields = false } = {}) => {
    setStep('form');
    clearAuthFeedback();
    resetOtpFlowState();
    if (resetFields) {
      setFormData(createEmptyFormData());
    } else {
      setFormData((prev) => ({
        ...prev,
        password: '',
        confirmPassword: '',
      }));
    }
  };

  const openResetPasswordStep = (detail) => {
    setStep('reset-password');
    resetOtpFlowState({ preserveFlowToken: true });
    setFormData((prev) => ({
      ...prev,
      password: '',
      confirmPassword: '',
    }));
    setAuthSuccess({
      title: t('login.reset.verifiedTitle', {}, 'Recovery Verified'),
      detail,
    });
  };

  const finishAuthAndNavigate = (successState, destination = from) => {
    pendingAuthDestinationRef.current = resolveNavigationTarget(destination, from);
    setAuthSuccess(null);
    setPendingAuthSuccess(successState);
  };

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = setTimeout(() => setCountdown((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    desktopBrowserHandoffCompletedRef.current = null;
    setIsLoading(false);
    setDesktopBrowserConsentGrantedKey('');
    setDesktopBrowserConsentSubmitting(false);
    setDesktopBrowserConsentStage('idle');
    setDesktopBrowserHandoffPreflight(null);
    setDesktopBrowserHandoffPreflightReadyKey('');
    setDesktopBrowserHandoffPreflightFailed(false);
    desktopBrowserHandoffPreflightAttemptRef.current = '';
    setDesktopBrowserCookieSession(null);
  }, [desktopBrowserHandoffKey]);

  useEffect(() => {
    if (!desktopBrowserCookieSessionRequired) {
      setDesktopBrowserCookieSessionLoading(false);
      return undefined;
    }

    let cancelled = false;
    setDesktopBrowserCookieSessionLoading(true);
    setAuthError(null);

    authApi.getSession({ preferCookieSession: true })
      .then((payload) => {
        if (cancelled) return;
        if (payload?.status !== 'authenticated') {
          throw new Error('The verified browser session could not be restored for desktop sign-in.');
        }
        setDesktopBrowserCookieSession(payload);
      })
      .catch((error) => {
        if (!cancelled) {
          setDesktopBrowserCookieSession(null);
          setAuthError(resolveAuthError(error, t));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDesktopBrowserCookieSessionLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [desktopBrowserCookieSessionRequired, desktopBrowserHandoffKey, t]);

  useEffect(() => {
    if (
      !desktopBrowserHandoff.active
      || !desktopBrowserHandoffKey
      || loading
      || desktopBrowserCookieSessionLoading
      || desktopBrowserConsentGranted
      || desktopBrowserHandoffCheckpoint
      || desktopBrowserHandoffPreflightReadyKey === desktopBrowserHandoffKey
      || desktopBrowserHandoffPreflightAttemptRef.current === desktopBrowserHandoffKey
      || (
        desktopBrowserCookieSessionRequired
          ? desktopBrowserCookieSession?.status !== 'authenticated'
          : (!isAuthenticated || !currentUser?.getIdToken)
      )
    ) {
      return undefined;
    }

    const handoffKey = desktopBrowserHandoffKey;
    desktopBrowserHandoffPreflightAttemptRef.current = handoffKey;
    setDesktopBrowserConsentSubmitting(true);
    setDesktopBrowserConsentStage('preflight');
    setAuthError(null);
    setAuthSuccess(null);

    runDesktopBrowserHandoffPreflight({ handoffKey })
      .catch((error) => {
        if (desktopBrowserHandoffKeyRef.current === handoffKey) {
          setDesktopBrowserHandoffPreflightFailed(true);
          setAuthError(resolveAuthError(error, t));
        }
      })
      .finally(() => {
        if (desktopBrowserHandoffKeyRef.current === handoffKey) {
          setDesktopBrowserConsentSubmitting(false);
          setDesktopBrowserConsentStage('idle');
        }
      });
    return undefined;
  }, [
    currentUser,
    desktopBrowserConsentGranted,
    desktopBrowserCookieSession?.status,
    desktopBrowserCookieSessionLoading,
    desktopBrowserCookieSessionRequired,
    desktopBrowserHandoff.active,
    desktopBrowserHandoffCheckpoint,
    desktopBrowserHandoffKey,
    desktopBrowserHandoffPreflightReadyKey,
    isAuthenticated,
    loading,
    runDesktopBrowserHandoffPreflight,
    t,
  ]);

  useEffect(() => {
    if (!desktopBrowserHandoff.active || !desktopBrowserHandoffIsInline) {
      return;
    }

    if (!persistDesktopBrowserHandoff(desktopBrowserHandoff)) {
      setAuthError(resolveAuthError(new Error(
        'Desktop sign-in could not secure the browser handoff. Refresh from Aura Desktop and try again.'
      ), t));
      return;
    }

    navigate(stripInlineDesktopBrowserHandoff(location), {
      replace: true,
      state: location.state,
    });
  }, [
    desktopBrowserHandoff,
    desktopBrowserHandoffIsInline,
    location,
    navigate,
    t,
  ]);

  useEffect(() => {
    if (loading) return;

    const isInitialResolvedCheck = !initialResolvedAuthRedirectCheckedRef.current;
    if (isInitialResolvedCheck) {
      initialResolvedAuthRedirectCheckedRef.current = true;
    }

    if (!isAuthenticated || desktopBrowserHandoff.active) return;

    if (pendingAuthSuccess) {
      if (authenticatedNavigationTimerRef.current) return;

      setAuthSuccess(pendingAuthSuccess);
      setPendingAuthSuccess(null);
      authenticatedNavigationTimerRef.current = setTimeout(() => {
        authenticatedNavigationTimerRef.current = null;
        const destination = pendingAuthDestinationRef.current || from;
        pendingAuthDestinationRef.current = '';
        navigate(destination, { replace: true });
      }, 1200);
      return;
    }

    if (isInitialResolvedCheck) {
      navigate(from, { replace: true });
    }
  }, [desktopBrowserHandoff.active, from, isAuthenticated, loading, navigate, pendingAuthSuccess]);

  useEffect(() => {
    if (
      !desktopBrowserHandoff.active
      || !desktopBrowserConsentGranted
      || loading
      || desktopBrowserCookieSessionRequired
      || !isAuthenticated
      || !currentUser?.getIdToken
    ) {
      return;
    }

    let cancelled = false;

    completeDesktopBrowserHandoff({
      firebaseUser: currentUser,
      isCancelled: () => cancelled,
    });

    return () => {
      cancelled = true;
    };
  }, [
    completeDesktopBrowserHandoff,
    currentUser,
    desktopBrowserHandoff.active,
    desktopBrowserCookieSessionRequired,
    desktopBrowserConsentGranted,
    isAuthenticated,
    loading,
  ]);

  useEffect(() => {
    if (
      !desktopBrowserHandoff.active
      || !desktopBrowserConsentGranted
      || loading
      || !desktopBrowserCookieSessionRequired
      || desktopBrowserCookieSession?.status !== 'authenticated'
    ) {
      return;
    }

    let cancelled = false;

    completeDesktopBrowserHandoff({
      preferCookieSession: true,
      isCancelled: () => cancelled,
    });

    return () => {
      cancelled = true;
    };
  }, [
    completeDesktopBrowserHandoff,
    desktopBrowserHandoff.active,
    desktopBrowserCookieSession?.status,
    desktopBrowserCookieSessionRequired,
    desktopBrowserConsentGranted,
    loading,
  ]);

  useEffect(() => {
    const inferredCountryCode = resolvePhoneCountryCode(formData.phone, phoneCountryCode || marketCountryCode);
    if (inferredCountryCode && inferredCountryCode !== phoneCountryCode) {
      setPhoneCountryCode(inferredCountryCode);
    }
  }, [formData.phone, marketCountryCode, phoneCountryCode]);

  useEffect(() => {
    if (authAccelerationHydratedRef.current) return;
    authAccelerationHydratedRef.current = true;

    const storedIdentity = readAuthIdentityMemory();
    const storedDraft = readAuthJourneyDraft(authAccelerationIntl);

    if (storedIdentity) {
      setIdentityMemory(storedIdentity);
      if (!hasLaunchDirective) {
        setFormData((prev) => ({
          ...prev,
          email: prev.email || storedIdentity.email || '',
          phone: prev.phone || storedIdentity.phone || '',
        }));
      }
    }

    if (!storedDraft) return;

    setResumeDraft(storedDraft);
    setFormData((prev) => ({
      ...prev,
      name: prev.name || storedDraft.name || storedIdentity?.displayName || '',
      email: prev.email || storedDraft.email || storedIdentity?.email || '',
      phone: prev.phone || storedDraft.phone || storedIdentity?.phone || '',
    }));

    if (!hasLaunchDirective) {
      setMode(storedDraft.mode);
    }

    if (storedDraft.canResumeOtp) {
      setMode(storedDraft.mode);
      setStep('otp');
      setOtpStage(storedDraft.otpStage);
      setOtpTransport(storedDraft.otpTransport);
      setCountdown(storedDraft.countdown);
    }
  }, [authAccelerationIntl, hasLaunchDirective]);

  useEffect(() => () => {
    clearFirebaseChallenge().catch(() => {});
    desktopBrowserAbortControllerRef.current?.abort();
    if (authenticatedNavigationTimerRef.current) {
      clearTimeout(authenticatedNavigationTimerRef.current);
      authenticatedNavigationTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      clearAuthJourneyDraft();
      return;
    }

    const email = normalizeEmail(formData.email);
    const phone = currentPhoneE164;
    const name = formData.name.trim();
    const hasIdentity = Boolean(email || phone || name);

    if (!hasIdentity && step === 'form') {
      clearAuthJourneyDraft();
      return;
    }

    writeAuthJourneyDraft({
      mode,
      step,
      name,
      email,
      phone,
      otpStage,
      otpTransport,
      countdown,
      fallbackToBackupOtp: Boolean(firebasePhoneFallback?.disableFirebasePhoneOtp),
    });
  }, [
    countdown,
    currentPhoneE164,
    currentUser,
    firebasePhoneFallback?.disableFirebasePhoneOtp,
    formData.email,
    formData.name,
    formData.phone,
    mode,
    otpStage,
    otpTransport,
    step,
  ]);

  const handleChange = (event) => {
    setFormData((prev) => ({
      ...prev,
      [event.target.name]: event.target.value,
    }));
    setAuthError(null);
  };

  const handlePhoneCountryChange = (event) => {
    const nextCountryCode = resolvePhoneCountryCode('', event.target.value);
    const nextPhone = buildInternationalPhoneNumber(phoneLocalValue, nextCountryCode);

    setPhoneCountryCode(nextCountryCode);
    setFormData((prev) => ({
      ...prev,
      phone: nextPhone,
    }));
    setAuthError(null);
  };

  const handlePhoneChange = (event) => {
    const rawPhone = event.target.value;
    const nextCountryCode = resolvePhoneCountryCode(rawPhone, phoneCountryCode);

    if (nextCountryCode !== phoneCountryCode) {
      setPhoneCountryCode(nextCountryCode);
    }

    setFormData((prev) => ({
      ...prev,
      phone: buildInternationalPhoneNumber(rawPhone, nextCountryCode),
    }));
    setAuthError(null);
  };

  const handleOtpChange = (index, value) => {
    if (!/^\d*$/.test(value)) return;

    const nextOtp = [...otpValues];
    nextOtp[index] = value.slice(-1);
    setOtpValues(nextOtp);
    setAuthError(null);

    if (value && index < OTP_LENGTH - 1) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index, event) => {
    if (event.key === 'Backspace' && !otpValues[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (event) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    const nextOtp = [...otpValues];
    pasted.split('').forEach((digit, index) => {
      nextOtp[index] = digit;
    });
    setOtpValues(nextOtp);
    const focusIndex = Math.min(pasted.length, OTP_LENGTH - 1);
    otpRefs.current[focusIndex]?.focus();
  };

  const getOtpString = () => otpValues.join('');

  const applySavedIdentity = (memory = null) => {
    if (!memory) return;

    clearFirebaseChallenge().catch(() => {});
    setResumeDraft(null);
    setMode('signin');
    setStep('form');
    clearAuthFeedback();
    resetOtpFlowState();
    setFirebasePhoneFallback(null);
    setFormData((prev) => ({
      ...prev,
      name: prev.name || memory.displayName || '',
      email: memory.email || prev.email,
      phone: memory.phone || prev.phone,
      password: '',
      confirmPassword: '',
    }));
  };

  const startOtpStep = ({
    transport,
    stage = OTP_STAGE.SINGLE,
    success,
    resetCountdown = true,
  }) => {
    setOtpTransport(transport);
    setOtpStage(stage);
    setStep('otp');
    setOtpValues(createEmptyOtpValues());
    if (resetCountdown) {
      setCountdown(60);
    }
    setAuthSuccess(success);
    setTimeout(() => otpRefs.current[0]?.focus(), 300);
  };

  const buildOtpSuccessState = ({
    transport,
    stage = OTP_STAGE.SINGLE,
    resend = false,
    fallback = null,
  } = {}) => {
    const modeLabel = mode === 'signup'
      ? t('login.otp.mode.accountSetup', {}, 'account setup')
      : mode === 'forgot-password'
        ? t('login.otp.mode.passwordRecovery', {}, 'password recovery')
        : t('login.otp.mode.signIn', {}, 'sign-in');
    const phoneOutcome = mode === 'signup'
      ? t('login.otp.phoneOutcome.activateAccount', {}, 'finish activating your account')
      : mode === 'forgot-password'
        ? t('login.otp.phoneOutcome.unlockReset', {}, 'unlock password reset')
        : t('login.otp.phoneOutcome.finishSignIn', {}, 'finish signing in');

    if (fallback) {
      return resend ? fallback.resendSuccess : fallback.success;
    }

    if (stage === OTP_STAGE.EMAIL) {
      return {
        title: resend
          ? t('login.otp.email.codesResent.title', {}, 'Codes Re-Sent')
          : t('login.otp.email.codeSent.title', {}, 'Email Code Sent'),
        detail: resend
          ? t('login.otp.email.codesResent.detail', { mode: modeLabel }, 'Fresh {{mode}} codes were sent. Enter the email code first, then confirm the same flow with Firebase SMS.')
          : t('login.otp.email.codeSent.detail', { mode: modeLabel }, 'Your email code is ready. After that, you will confirm the same {{mode}} with Firebase SMS on your phone.'),
      };
    }

    if (stage === OTP_STAGE.PHONE && transport === OTP_TRANSPORT.FIREBASE_SMS) {
      return {
        title: t('login.otp.phone.emailVerified.title', {}, 'Email Verified'),
        detail: t('login.otp.phone.emailVerified.detail', { outcome: phoneOutcome }, 'Step 1 is complete. Enter the Firebase SMS code sent to your phone to {{outcome}}.'),
      };
    }

    if (transport === OTP_TRANSPORT.FIREBASE_SMS) {
      return {
        title: resend
          ? t('login.otp.firebase.codeResent.title', {}, 'Firebase Code Re-Sent')
          : t('login.otp.firebase.smsSent.title', {}, 'Firebase SMS Sent'),
        detail: resend
          ? t('login.otp.firebase.codeResent.detail', {}, 'A fresh 6-digit Firebase verification code is on its way to your phone.')
          : t('login.otp.firebase.smsSent.detail', {}, 'A 6-digit Firebase verification code has been sent to your phone.'),
      };
    }

    return {
      title: t('login.otp.backend.checkForCode.title', {}, 'Check for a Code'),
      detail: resend
        ? t('login.otp.backend.codeResent.detail', {}, 'If the account details are valid, a fresh verification code has been sent.')
        : t('login.otp.backend.codeSent.detail', {}, 'If the account details are valid, a 6-digit verification code has been sent.'),
    };
  };

  const sendBackendOtp = async ({
    email,
    phone,
    purpose,
    password,
    resend = false,
    successOverride = null,
  }) => {
    let credentialProofToken = '';

    if (mode === 'signin') {
      const precheck = await verifyCredentialsWithoutSession(email, password);
      credentialProofToken = precheck?.credentialProofToken || '';
      if (!credentialProofToken) {
        throw new Error('Unable to verify credentials for secure OTP flow.');
      }
      setSignInProofToken(credentialProofToken);
    }

    await otpApi.sendOtp(email, phone, purpose, buildTurnstileRequestOptions({
      ...(mode === 'signin' ? { credentialProofToken } : {}),
    }));
    refreshTurnstile();

    startOtpStep({
      transport: OTP_TRANSPORT.BACKEND_OTP,
      stage: OTP_STAGE.SINGLE,
      success: successOverride || buildOtpSuccessState({
        transport: OTP_TRANSPORT.BACKEND_OTP,
        stage: OTP_STAGE.SINGLE,
        resend,
      }),
    });
  };

  const startDualChannelFlow = async ({ email, phone, resend = false }) => {
    await clearFirebaseChallenge();
    setSignInProofToken('');
    setLoginFlowToken('');

    try {
      const purpose = getAuthPurpose(mode);
      const turnstileRequestOptions = buildTurnstileRequestOptions();

      if (mode === 'signin') {
        const challenge = await startFirebasePhoneLoginChallenge({
          email,
          password: formData.password,
          phone,
          recaptchaContainer: recaptchaContainerRef.current,
        });

        firebasePhoneChallengeRef.current = challenge;

        const credentialProofToken = String(challenge?.credentialProofToken || '').trim();
        if (!credentialProofToken) {
          throw new Error('Unable to start secure sign-in proof. Please try again.');
        }

        setSignInProofToken(credentialProofToken);

        await otpApi.sendOtp(email, phone, purpose, {
          ...turnstileRequestOptions,
          credentialProofToken,
          skipSms: true,
          strictIdentity: true,
        });
      } else {
        const challenge = await startFirebasePhoneCodeChallenge({
          phone,
          recaptchaContainer: recaptchaContainerRef.current,
        });

        firebasePhoneChallengeRef.current = challenge;

        await otpApi.sendOtp(email, phone, purpose, {
          ...turnstileRequestOptions,
          skipSms: true,
        });
      }
      refreshTurnstile();

      startOtpStep({
        transport: OTP_TRANSPORT.BACKEND_OTP,
        stage: OTP_STAGE.EMAIL,
        success: buildOtpSuccessState({
          transport: OTP_TRANSPORT.BACKEND_OTP,
          stage: OTP_STAGE.EMAIL,
          resend,
        }),
      });
    } catch (error) {
      setSignInProofToken('');
      await clearFirebaseChallenge();
      throw error;
    }
  };

  const finalizePhoneBackedSignIn = async (email, verifiedPhoneFactor) => {
    const resolvedFlowToken = typeof loginFlowToken === 'string' ? loginFlowToken.trim() : '';
    if (!resolvedFlowToken) {
      throw new Error('Secure login token expired. Please request a fresh code.');
    }

    if (!verifiedPhoneFactor?.credential) {
      throw new Error('Secure phone-backed sign-in could not be completed. Please request a new code.');
    }

    await loginWithPhoneCredential(verifiedPhoneFactor.credential, {
      email,
      phone: verifiedPhoneFactor.phoneE164 || currentPhoneE164,
      loginFlowToken: resolvedFlowToken,
    });
  };

  const validateStrongPasswordFields = ({ password, confirmPassword }) => {
    if (!password) { setErr({ message: t('login.error.passwordRequired', {}, 'Password is required') }); return false; }
    if (password.length < 12) { setErr({ message: t('login.error.passwordLength', {}, 'Password must be at least 12 characters') }); return false; }
    if (!/[A-Z]/.test(password)) { setErr({ message: t('login.error.passwordUppercase', {}, 'Password must contain an uppercase letter') }); return false; }
    if (!/[a-z]/.test(password)) { setErr({ message: t('login.error.passwordLowercase', {}, 'Password must contain a lowercase letter') }); return false; }
    if (!/[0-9]/.test(password)) { setErr({ message: t('login.error.passwordDigit', {}, 'Password must contain a digit') }); return false; }
    if (!/[!@#$%^&*]/.test(password)) { setErr({ message: t('login.error.passwordSpecial', {}, 'Password must contain a special character (!@#$%^&*)') }); return false; }
    if (password !== confirmPassword) { setErr({ message: t('login.error.passwordMismatch', {}, 'Passwords do not match') }); return false; }
    return true;
  };

  const validateForm = () => {
    if (!currentPhoneE164) {
      setErr({ message: t('login.error.phoneRequired', {}, 'Phone number is required') });
      return false;
    }
    if (!validatePhone(currentPhoneE164)) {
      setErr({ message: t('login.error.phoneValid', {}, 'Use international phone format with country code, for example +1 202 555 0142') });
      return false;
    }
    if (mode === 'signup') {
      if (!formData.name) { setErr({ message: t('login.error.fullNameRequired', {}, 'Full name is required') }); return false; }
      if (!formData.email) { setErr({ message: t('login.error.emailRequired', {}, 'Email address is required') }); return false; }
      if (!validateEmail(formData.email)) { setErr({ message: t('login.error.emailValid', {}, 'Valid email address is required') }); return false; }
      if (!validateStrongPasswordFields({
        password: formData.password,
        confirmPassword: formData.confirmPassword,
      })) {
        return false;
      }
    }
    if (mode === 'signin') {
      if (!formData.email) { setErr({ message: t('login.error.emailRequired', {}, 'Email address is required') }); return false; }
      if (!validateEmail(formData.email)) { setErr({ message: t('login.error.emailValid', {}, 'Valid email address is required') }); return false; }
      if (!formData.password) { setErr({ message: t('login.error.passwordRequired', {}, 'Password is required') }); return false; }
    }
    if (mode === 'forgot-password') {
      if (!formData.email) { setErr({ message: t('login.error.emailRequired', {}, 'Email address is required') }); return false; }
      if (!validateEmail(formData.email)) { setErr({ message: t('login.error.emailValid', {}, 'Valid email address is required') }); return false; }
    }
    return true;
  };

  const handleSendOtp = async () => {
    if (!validateForm()) return;
    if (mode === 'signup' && currentUser) {
      setErr({ message: t('login.error.alreadySignedIn', {}, 'You are already signed in. Please log out before creating another account.') });
      return;
    }

    setIsLoading(true);
    setAuthError(null);
    setLoginFlowToken('');
    setAuthSuccess(null);

    try {
      const email = normalizeEmail(formData.email);
      const phone = currentPhoneE164;
      const purpose = getAuthPurpose(mode);
      let backendSuccessOverride = null;

      if (canUseFirebasePhoneOtp) {
        try {
          await startDualChannelFlow({ email, phone });
          return;
        } catch (firebasePhoneError) {
          const fallback = resolveFirebasePhoneFallback(firebasePhoneError);
          if (!fallback) {
            setErr(firebasePhoneError);
            return;
          }
          if (fallback.disableFirebasePhoneOtp) {
            setFirebasePhoneFallback(fallback);
          }
          backendSuccessOverride = buildOtpSuccessState({
            transport: OTP_TRANSPORT.BACKEND_OTP,
            stage: OTP_STAGE.SINGLE,
            fallback,
          });
          await clearFirebaseChallenge();
        }
      }

      await sendBackendOtp({
        email,
        phone,
        purpose,
        password: formData.password,
        successOverride: backendSuccessOverride,
      });
    } catch (error) {
      if (turnstileEnabled) {
        refreshTurnstile();
      }
      if ((mode === 'signin' || mode === 'forgot-password')
        && isEnumerationSensitiveOtpError(error)
        && !shouldKeepSpecificOtpError(error)) {
        setErr(buildGenericOtpFlowError(t));
      } else {
        setErr(error);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const otpString = getOtpString();
    if (otpString.length !== OTP_LENGTH) {
      setErr({ message: t('login.otp.error.incomplete', {}, 'Enter complete 6-digit OTP') });
      return;
    }

    setIsLoading(true);
    setAuthError(null);
    setAuthSuccess(null);

    try {
      const email = normalizeEmail(formData.email);
      const phone = currentPhoneE164;
      const purpose = getAuthPurpose(mode);

      if (isEmailOtpStage) {
        const verificationResult = await otpApi.verifyOtp(phone, otpString, purpose, buildTurnstileRequestOptions({
          email,
          factor: 'email',
        }));
        refreshTurnstile();
        const nextFlowToken = String(verificationResult?.flowToken || '').trim();
        if (mode === 'signin' && !nextFlowToken) {
          throw new Error('Secure login token expired. Please request a fresh code.');
        }
        setLoginFlowToken(nextFlowToken);
        startOtpStep({
          transport: OTP_TRANSPORT.FIREBASE_SMS,
          stage: OTP_STAGE.PHONE,
          success: buildOtpSuccessState({
            transport: OTP_TRANSPORT.FIREBASE_SMS,
            stage: OTP_STAGE.PHONE,
          }),
          resetCountdown: false,
        });
        return;
      }

      if (isPhoneOtpStage) {
        const activeChallenge = firebasePhoneChallengeRef.current;
        if (!activeChallenge) {
          setErr({ message: t('login.otp.error.phoneChallengeExpired', {}, 'Secure phone challenge expired. Please request a new code.') });
          setStep('form');
          return;
        }

        const verifiedPhoneFactor = mode === 'signin'
          ? await completeFirebasePhoneLoginChallenge(activeChallenge, otpString)
          : await completeFirebasePhoneCodeChallenge(activeChallenge, otpString);

        try {
          if (mode !== 'signin') {
            const completionResult = await authApi.completePhoneFactorVerification(purpose, email, verifiedPhoneFactor.phoneE164, buildTurnstileRequestOptions({
              firebaseUser: verifiedPhoneFactor.user,
            }));
            refreshTurnstile();
            if (mode === 'forgot-password') {
              const nextFlowToken = String(completionResult?.flowToken || '').trim();
              if (!nextFlowToken) {
                throw new Error('Secure recovery token expired. Please request a fresh code.');
              }
              setLoginFlowToken(nextFlowToken);
            }
          }
        } finally {
          await clearFirebaseChallenge();
        }

        if (mode === 'signin') {
          await finalizePhoneBackedSignIn(email, verifiedPhoneFactor);
          resetOtpFlowState();
          finishAuthAndNavigate(resolveAuthSuccess('signin_success', t));
        } else if (mode === 'signup') {
          await signup(email, formData.password, formData.name.trim(), phone);
          resetOtpFlowState();
          finishAuthAndNavigate(resolveAuthSuccess('signup_success', t));
        } else if (mode === 'forgot-password') {
          openResetPasswordStep(
            t(
              'login.reset.verifiedDual',
              {},
              'Your email OTP and Firebase phone verification are complete. Set a new password for this account now.'
            )
          );
        }
        return;
      }

      const otpResult = await otpApi.verifyOtp(phone, otpString, purpose, buildTurnstileRequestOptions());
      refreshTurnstile();

      if (mode === 'signup') {
        await signup(email, formData.password, formData.name.trim(), phone);
        finishAuthAndNavigate(resolveAuthSuccess('signup_success', t));
      } else if (mode === 'signin') {
        const flowToken = String(otpResult?.flowToken || '').trim();
        if (!flowToken) {
          throw new Error('Secure login token expired. Please request a fresh code.');
        }
        await login(email, formData.password, {
          loginFlowToken: flowToken,
          phone,
        });
        resetOtpFlowState();
        finishAuthAndNavigate(resolveAuthSuccess('signin_success', t));
      } else if (mode === 'forgot-password') {
        const flowToken = String(otpResult?.flowToken || '').trim();
        if (!flowToken) {
          throw new Error('Secure recovery token expired. Please request a fresh code.');
        }
        setLoginFlowToken(flowToken);
        openResetPasswordStep(
          t(
            'login.reset.verifiedSingle',
            {},
            'Your email and phone are verified. Set a new password for this account now.'
          )
        );
        return;
      }
      setSignInProofToken('');
      setLoginFlowToken('');
    } catch (error) {
      if (turnstileEnabled) {
        refreshTurnstile();
      }
      if ((mode === 'signin' || mode === 'forgot-password')
        && isEnumerationSensitiveOtpError(error)
        && !shouldKeepSpecificOtpError(error)) {
        setErr(buildGenericOtpFlowError(t));
      } else {
        setErr(error);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (countdown > 0) return;

    setIsLoading(true);
    setAuthError(null);

    try {
      const email = normalizeEmail(formData.email);
      const phone = currentPhoneE164;
      const purpose = getAuthPurpose(mode);
      let backendSuccessOverride = null;

      if (otpStage !== OTP_STAGE.SINGLE && canUseFirebasePhoneOtp) {
        try {
          await startDualChannelFlow({ email, phone, resend: true });
          return;
        } catch (firebasePhoneError) {
          const fallback = resolveFirebasePhoneFallback(firebasePhoneError);
          if (!fallback) {
            throw firebasePhoneError;
          }
          if (fallback.disableFirebasePhoneOtp) {
            setFirebasePhoneFallback(fallback);
          }
          backendSuccessOverride = buildOtpSuccessState({
            transport: OTP_TRANSPORT.BACKEND_OTP,
            stage: OTP_STAGE.SINGLE,
            resend: true,
            fallback,
          });
          await clearFirebaseChallenge();
        }
      }

      if (mode === 'signin' && !signInProofToken) {
        setErr({ message: t('login.otp.error.signInProofExpired', {}, 'Secure sign-in proof expired. Please re-enter credentials.') });
        setStep('form');
        return;
      }

      await sendBackendOtp({
        email,
        phone,
        purpose,
        password: formData.password,
        resend: true,
        successOverride: backendSuccessOverride,
      });
    } catch (error) {
      if (turnstileEnabled) {
        refreshTurnstile();
      }
      if ((mode === 'signin' || mode === 'forgot-password')
        && isEnumerationSensitiveOtpError(error)
        && !shouldKeepSpecificOtpError(error)) {
        setErr(buildGenericOtpFlowError(t));
      } else {
        setErr(error);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const switchMode = (newMode) => {
    clearFirebaseChallenge().catch(() => {});
    clearAuthJourneyDraft();
    setResumeDraft(null);
    setMode(newMode);
    setFirebasePhoneFallback(null);
    resetToFormStep({ resetFields: true });
  };

  const goBack = () => {
    clearFirebaseChallenge().catch(() => {});
    resetToFormStep();
  };

  const handleResetPassword = async () => {
    if (!validateStrongPasswordFields({
      password: formData.password,
      confirmPassword: formData.confirmPassword,
    })) {
      return;
    }
    if (resetPasswordRequestInFlightRef.current) {
      return;
    }

    resetPasswordRequestInFlightRef.current = true;
    setIsLoading(true);
    setAuthError(null);
    setAuthSuccess(null);

    try {
      const resolvedFlowToken = typeof loginFlowToken === 'string' ? loginFlowToken.trim() : '';
      if (!resolvedFlowToken) {
        throw new Error('Secure recovery token expired. Please restart password recovery.');
      }

      await otpApi.resetPassword({
        flowToken: resolvedFlowToken,
        password: formData.password,
        ...buildTurnstileRequestOptions(),
      });
      refreshTurnstile();

      setAuthSuccess(resolveAuthSuccess('password_reset_success', t));
      setTimeout(() => {
        setMode('signin');
        resetToFormStep();
      }, 1400);
    } catch (error) {
      if (turnstileEnabled) {
        refreshTurnstile();
      }
      if (isResetPasswordRateLimitError(error)) {
        resetOtpFlowState();
        setStep('form');
        setFormData((prev) => ({
          ...prev,
          password: '',
          confirmPassword: '',
        }));
        setErr(error);
        return;
      }
      if (isTerminalResetGrantError(error)) {
        resetOtpFlowState();
        setStep('form');
        setFormData((prev) => ({
          ...prev,
          password: '',
          confirmPassword: '',
        }));
        setErr('password reset verification expired');
      } else {
        const status = Number(error?.status || error?.data?.statusCode || error?.data?.status || 0);
        if (status >= 401) {
          resetOtpFlowState();
          setStep('form');
          setFormData((prev) => ({
            ...prev,
            password: '',
            confirmPassword: '',
          }));
        }
        setErr(error);
      }
    } finally {
      resetPasswordRequestInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (step === 'form') {
      handleSendOtp();
    } else if (step === 'otp') {
      handleVerifyOtp();
    } else if (step === 'reset-password') {
      handleResetPassword();
    }
  };

  const info = useMemo(() => {
    if (step === 'reset-password') {
      return {
        title: t('login.info.reset.title', {}, 'SET NEW PASSWORD'),
        desc: t('login.info.reset.desc', {}, 'Your recovery verification is complete for the registered email and phone. Choose a fresh password to regain access securely.'),
      };
    }

    if (step === 'otp') {
      if (isEmailOtpStage) {
        return {
          title: t('login.info.otp.email.title', {}, 'VERIFY EMAIL'),
          desc: mode === 'signup'
            ? t('login.info.otp.email.signup', {}, 'Step 1 of 2. Enter the 6-digit code sent to your email, then finish account activation with Firebase SMS on your phone.')
            : mode === 'forgot-password'
              ? t('login.info.otp.email.forgot', {}, 'Step 1 of 2. Enter the 6-digit code sent to your email, then finish recovery with Firebase SMS on your phone.')
              : t('login.info.otp.email.signin', {}, 'Step 1 of 2. Enter the 6-digit code sent to your email, then finish the same sign-in with Firebase SMS on your phone.'),
        };
      }

      if (isPhoneOtpStage) {
        return {
          title: t('login.info.otp.phone.title', {}, 'VERIFY PHONE'),
          desc: mode === 'signup'
            ? t('login.info.otp.phone.signup', {}, 'Step 2 of 2. Enter the Firebase SMS code sent to your phone to activate your account securely.')
            : mode === 'forgot-password'
              ? t('login.info.otp.phone.forgot', {}, 'Step 2 of 2. Enter the Firebase SMS code sent to your phone to unlock secure password recovery.')
              : t('login.info.otp.phone.signin', {}, 'Step 2 of 2. Enter the Firebase SMS code sent to your phone to complete secure sign-in.'),
        };
      }

      return {
        title: t('login.info.otp.title', {}, 'VERIFY OTP'),
        desc: otpTransport === OTP_TRANSPORT.FIREBASE_SMS
          ? t('login.info.otp.firebase', {}, 'Enter the 6-digit Firebase SMS code sent to your phone to complete the login.')
          : t('login.info.otp.default', { extra: formData.phone ? t('login.info.otp.defaultExtra', {}, ' and phone') : '' }, 'Enter the 6-digit code sent to your email{{extra}}.'),
      };
    }

    switch (mode) {
      case 'signup':
        return {
          title: t('login.info.signup.title', {}, 'CREATE ACCOUNT'),
          desc: firebasePhoneFallback?.disableFirebasePhoneOtp
            ? t('login.info.signup.fallback', {}, 'Firebase phone delivery is unavailable on this deployment, so secure backup OTP codes will be sent through the available secure verification channel before account creation.')
            : canUseFirebasePhoneOtp
              ? t('login.info.signup.dual', {}, 'Sign up with your details, then verify the account with one code to email and one Firebase SMS code to your phone.')
              : t('login.info.signup.single', {}, 'Sign up with your phone number. We\'ll verify it with an OTP sent to your email and phone.'),
        };
      case 'forgot-password':
        return {
          title: t('login.info.forgot.title', {}, 'RESET PASSWORD'),
          desc: firebasePhoneFallback?.disableFirebasePhoneOtp
            ? t('login.info.forgot.fallback', {}, 'Firebase phone delivery is unavailable on this deployment, so secure backup OTP codes will be sent through the available secure verification channel before password reset.')
            : canUseFirebasePhoneOtp
              ? t('login.info.forgot.dual', {}, 'Enter your registered email and phone number, then verify recovery with one code to email and one Firebase SMS code to your phone.')
              : t('login.info.forgot.single', {}, 'Enter your registered email and phone number. We\'ll verify both before allowing a new password.'),
        };
      default:
        return {
          title: t('login.info.signin.title', {}, 'WELCOME BACK'),
          desc: firebasePhoneFallback?.disableFirebasePhoneOtp
            ? t('login.info.signin.fallback', {}, 'Firebase phone delivery is unavailable on this deployment, so secure backup OTP codes will be sent through the available secure verification channel after your password is checked.')
            : canUseFirebasePhoneOtp
              ? t('login.info.signin.dual', {}, 'Sign in with your password, then verify the login with one code to email and one Firebase SMS code to your phone.')
              : t('login.info.signin.single', {}, 'Sign in with your credentials. We\'ll verify your identity with an OTP.'),
        };
    }
  }, [canUseFirebasePhoneOtp, firebasePhoneFallback?.disableFirebasePhoneOtp, formData.phone, isEmailOtpStage, isPhoneOtpStage, mode, otpTransport, step, t]);

  const trustNotes = useMemo(() => {
    if (step === 'reset-password') {
      return [
        t('login.trust.reset.1', {}, 'This password change is allowed only after verified recovery for the same email and phone.'),
        t('login.trust.reset.2', {}, 'Your new password must meet the full strength policy before it is saved.'),
        t('login.trust.reset.3', {}, 'Existing Firebase sessions are revoked after the reset so the new password takes effect cleanly.'),
      ];
    }

    if (step === 'otp') {
      if (isEmailOtpStage) {
        return [
          mode === 'signup'
            ? t('login.trust.otp.email.signup', {}, 'Step 1 verifies the email address that will own the new account.')
            : mode === 'forgot-password'
              ? t('login.trust.otp.email.forgot', {}, 'Step 1 verifies the registered recovery email for this account.')
              : t('login.trust.otp.email.signin', {}, 'Step 1 checks the email address tied to your password and registered phone number.'),
          t('login.trust.otp.email.2', {}, 'Step 2 will still require the Firebase phone code before this flow is finalized.'),
          t('login.trust.otp.email.3', {}, 'Both codes expire quickly and each resend refreshes the full secure verification chain.'),
        ];
      }

      if (isPhoneOtpStage) {
        return [
          mode === 'signup'
            ? t('login.trust.otp.phone.signup', {}, 'Your email step is already verified for this new account.')
            : mode === 'forgot-password'
              ? t('login.trust.otp.phone.forgot', {}, 'Your recovery email step is already verified for this account.')
              : t('login.trust.otp.phone.signin', {}, 'Your email step is already verified for this login attempt.'),
          t('login.trust.otp.phone.2', {}, 'The final Firebase SMS confirmation binds this flow to your registered phone.'),
          t('login.trust.otp.phone.3', {}, 'If the phone code expires, resend refreshes both email and phone factors together.'),
        ];
      }

      return [
        t('login.trust.otp.default.1', {}, 'Codes expire in 5 minutes and can be used only once.'),
        t('login.trust.otp.default.2', {}, 'Aura never asks for your OTP outside this secure verification step.'),
        t('login.trust.otp.default.3', {}, 'Retry and resend controls stay available if delivery is delayed.'),
      ];
    }

    if (mode === 'signup') {
      return [
        firebasePhoneFallback?.disableFirebasePhoneOtp
          ? t('login.trust.signup.1fallback', {}, 'Firebase phone delivery is unavailable here, so Aura is using secure backup delivery through the available verification channel before account creation.')
          : canUseFirebasePhoneOtp
            ? t('login.trust.signup.1dual', {}, 'Email is checked first, then Firebase phone verification finishes the new account securely.')
            : t('login.trust.signup.1single', {}, 'Email and phone are verified before a new account becomes active.'),
        t('login.trust.signup.2', {}, 'Seller, payment, and order access stay locked behind verified identity.'),
        t('login.trust.signup.3', {}, 'Fraud checks and duplicate-account controls run before activation.'),
      ];
    }

    if (mode === 'forgot-password') {
      return [
        firebasePhoneFallback?.disableFirebasePhoneOtp
          ? t('login.trust.forgot.1fallback', {}, 'Firebase phone delivery is unavailable here, so Aura is using secure backup delivery through the available verification channel before recovery continues.')
          : canUseFirebasePhoneOtp
            ? t('login.trust.forgot.1dual', {}, 'Recovery checks your email first, then requires Firebase phone verification before password reset.')
            : t('login.trust.forgot.1single', {}, 'Reset requests stay tied to your registered email and phone.'),
        t('login.trust.forgot.2', {}, 'A fresh verification chain is required before any password recovery step.'),
        t('login.trust.forgot.3', {}, 'Suspicious recovery attempts are rate-limited automatically.'),
      ];
    }

    return [
      firebasePhoneFallback?.disableFirebasePhoneOtp
        ? t('login.trust.signin.1fallback', {}, 'Firebase phone verification is unavailable here, so Aura is using secure backup delivery through the available verification channel.')
        : canUseFirebasePhoneOtp
          ? t('login.trust.signin.1dual', {}, 'Password is verified first, then login codes are sent to both your email and Firebase phone channel.')
          : t('login.trust.signin.1single', {}, 'Password validity is checked before an OTP is issued.'),
      t('login.trust.signin.2', {}, 'Phone confirmation reduces account-takeover risk before the session is finalized.'),
      t('login.trust.signin.3', {}, 'Rate limits, device checks, and audit logs guard repeated attempts.'),
    ];
  }, [canUseFirebasePhoneOtp, firebasePhoneFallback?.disableFirebasePhoneOtp, isEmailOtpStage, isPhoneOtpStage, mode, step, t]);

  const secureSignals = useMemo(() => {
    const socialProviders = ['Google', 'Facebook', 'GitHub', 'X'];
    if (socialAuthStatus.microsoftEnabled) socialProviders.push('Microsoft');
    if (socialAuthStatus.appleEnabled) socialProviders.push('Apple');
    const socialProviderSummary = formatProviderList(socialProviders);

    return [
    {
      label: step === 'otp' ? t('login.signal.windowOtp', {}, 'OTP window') : step === 'reset-password' ? t('login.signal.windowReset', {}, 'Reset window') : t('login.signal.identityGate', {}, 'Identity gate'),
      value: step === 'otp'
        ? t('login.signal.valueOtp', {}, '5-minute secure verify')
        : step === 'reset-password'
          ? t('login.signal.valueReset', {}, 'OTP verified, new password pending')
          : t('login.signal.valueIdentity', {}, 'Credentials checked before send'),
    },
    {
      label: t('login.signal.delivery', {}, 'Delivery'),
      value: isEmailOtpStage
        ? t('login.signal.deliveryEmail', {}, 'Email OTP live, Firebase phone pending')
        : isPhoneOtpStage
          ? t('login.signal.deliveryPhone', {}, 'Email verified, Firebase SMS active')
          : firebasePhoneFallback?.disableFirebasePhoneOtp
            ? t('login.signal.deliveryFallback', {}, 'Backup OTP fallback active')
            : canUseFirebasePhoneOtp
              ? t('login.signal.deliveryDual', {}, 'Email + Firebase SMS')
              : formData.phone ? t('login.signal.deliveryActive', {}, 'Email + phone active') : t('login.signal.deliveryRequired', {}, 'Email first, phone required'),
    },
    {
      label: t('login.signal.flow', {}, 'Flow'),
      value: mode === 'signup'
        ? t('login.signal.flowSignup', {}, 'New account activation')
        : mode === 'forgot-password'
          ? step === 'reset-password'
            ? t('login.signal.flowRecoveryUnlocked', {}, 'Recovery unlocked')
            : t('login.signal.flowRecovery', {}, 'Password recovery')
          : t('login.signal.flowSignin', {}, 'Secure sign-in'),
    },
    {
      label: t('login.signal.social', {}, 'Social access'),
      value: socialAuthStatus.supported
        ? (socialAuthStatus.microsoftEnabled || socialAuthStatus.appleEnabled
          ? t('login.signal.socialExpanded', { providers: socialProviderSummary }, '{{providers}} ready')
          : t('login.signal.socialAvailable', {}, 'Google, Facebook, GitHub, and X available'))
        : socialAuthStatus.disabledByMobileNativeConfig
          ? t('login.signal.socialMobileConfig', {}, 'Email OTP active in app')
        : socialAuthStatus.runtimeBlocked
          ? t('login.signal.socialBlocked', {}, 'OTP-only until this tab is refreshed')
          : t('login.signal.socialHost', { host: socialAuthStatus.runtimeHost || t('login.signal.thisHost', {}, 'this host') }, 'OTP-only on {{host}}'),
    },
  ];
  }, [
    canUseFirebasePhoneOtp,
    firebasePhoneFallback?.disableFirebasePhoneOtp,
    formData.phone,
    isEmailOtpStage,
    isPhoneOtpStage,
    mode,
    socialAuthStatus.appleEnabled,
    socialAuthStatus.disabledByMobileNativeConfig,
    socialAuthStatus.microsoftEnabled,
    socialAuthStatus.runtimeBlocked,
    socialAuthStatus.runtimeHost,
    socialAuthStatus.supported,
    step,
    t,
  ]);

  const accelerationCards = useMemo(() => {
    const cards = [];

    if (resumeDraft) {
      cards.push({
        key: 'resume-draft',
        icon: 'resume',
        eyebrow: t('login.acceleration.resume', {}, 'Resumable flow'),
        title: resumeDraft.resumeMessage?.title || t('login.acceleration.resumeTitle', {}, 'Fast recovery ready'),
        body: resumeDraft.resumeMessage?.detail || t('login.acceleration.resumeBody', {}, 'Your previous secure auth attempt can be restarted with the saved identity details.'),
        meta: resumeDraft.savedAtLabel
          ? t('login.acceleration.savedAt', { age: resumeDraft.savedAtLabel }, 'Saved {{age}}')
          : '',
      });
    }

    if (identityMemory) {
      const identityTitle = identityMemory.maskedEmail || identityMemory.maskedPhone || t('login.acceleration.identityTitle', {}, 'Known identity');
      const identityBody = identityMemory.assuranceLabel
        ? t(
          'login.acceleration.identityBody',
          {
            assurance: identityMemory.assuranceLabel,
            provider: identityMemory.providerLabel,
            age: identityMemory.savedAtLabel || t('login.acceleration.justNow', {}, 'just now'),
          },
          'Last secure session used {{assurance}} via {{provider}} {{age}}.'
        )
        : t(
          'login.acceleration.identityBodyFallback',
          {
            provider: identityMemory.providerLabel,
            age: identityMemory.savedAtLabel || t('login.acceleration.justNow', {}, 'just now'),
          },
          'Last secure session used {{provider}} {{age}}.'
        );

      cards.push({
        key: 'identity-memory',
        icon: 'identity',
        eyebrow: t('login.acceleration.identity', {}, 'Known identity'),
        title: identityTitle,
        body: identityBody,
        meta: identityMemory.maskedPhone || '',
        actionLabel: t('login.acceleration.useIdentity', {}, 'Use saved identity'),
        onAction: () => applySavedIdentity(identityMemory),
      });
    }

    const lane = describeAccelerationLane({
      mode,
      canUseFirebasePhoneOtp,
      socialAuthSupported: socialAuthStatus.supported,
      fallbackToBackupOtp: Boolean(firebasePhoneFallback?.disableFirebasePhoneOtp || resumeDraft?.fallbackToBackupOtp),
      intl: authAccelerationIntl,
    });

    cards.push({
      key: 'lane',
      icon: 'lane',
      eyebrow: t('login.acceleration.lane', {}, 'Fastest lane'),
      title: lane.title,
      body: lane.detail,
    });

    return cards;
  }, [
    authAccelerationIntl,
    canUseFirebasePhoneOtp,
    firebasePhoneFallback?.disableFirebasePhoneOtp,
    identityMemory,
    mode,
    resumeDraft,
    socialAuthStatus.supported,
    t,
  ]);

  const handleFeedbackAction = () => {
    if (!authError?.action) return;

    if (authError.action === 'resend') {
      handleResendOtp();
      return;
    }

    if (authError.action === 'back') {
      goBack();
      return;
    }

    switchMode(authError.action);
  };

  const handleSocialSignIn = async (providerSignIn, providerLabel = 'Social') => {
    setIsLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      if (canUseDesktopBrowserSignIn) {
        const result = await signInWithDesktopBrowser({ returnTo: from });
        if (!result?.redirecting) {
          finishAuthAndNavigate(resolveAuthSuccess('signin_success', t));
        }
        return;
      }

      const result = await providerSignIn();
      if (result?.redirecting) {
        return;
      }
      if (desktopBrowserHandoff.active) {
        return;
      }
      if (!result?.redirecting) {
        finishAuthAndNavigate(resolveAuthSuccess('signin_success', t));
      }
    } catch (error) {
      console.error(`${providerLabel} sign-in failed`, error);
      setErr(normalizeSocialAuthError(error, providerLabel, socialAuthStatus));
    } finally {
      setIsLoading(false);
    }
  };

  const startDesktopBrowserSignIn = async ({
    destination = from,
    startedTitle = t('login.desktopBrowser.startedTitle', {}, 'Continue in Your Browser'),
    startedDetail = t('login.desktopBrowser.startedDetail', {}, 'In the browser, enter your password and complete the email and phone codes. Aura Desktop will wait for up to 10 minutes.'),
    providerLabel = 'desktop browser',
  } = {}) => {
    if (!canUseDesktopBrowserSignIn) {
      setErr({ message: t('login.desktopBrowser.unavailable', {}, 'Desktop browser sign-in is available only in the Aura desktop app.') });
      return;
    }

    if (desktopBrowserSignInPending || desktopBrowserAbortControllerRef.current) return;

    const abortController = new AbortController();
    desktopBrowserAbortControllerRef.current = abortController;
    setDesktopBrowserSignInPending(true);
    setIsLoading(true);
    setAuthError(null);
    setAuthSuccess({
      title: startedTitle,
      detail: startedDetail,
    });

    const returnTo = resolveNavigationTarget(destination, from);
    try {
      const result = await signInWithDesktopBrowser({
        returnTo,
        signal: abortController.signal,
        onRequestStarted: ({ requestId = '' } = {}) => setDesktopBrowserRequestId(requestId),
      });
      if (!result?.redirecting) {
        finishAuthAndNavigate(resolveAuthSuccess('signin_success', t), returnTo);
      }
    } catch (error) {
      setAuthSuccess(null);
      setErr(normalizeSocialAuthError(error, providerLabel, socialAuthStatus));
    } finally {
      if (desktopBrowserAbortControllerRef.current === abortController) {
        desktopBrowserAbortControllerRef.current = null;
      }
      setDesktopBrowserSignInPending(false);
      setDesktopBrowserRequestId('');
      setIsLoading(false);
    }
  };

  const handleDesktopBrowserSignIn = () => startDesktopBrowserSignIn();

  const handleDesktopAdminSignIn = () => startDesktopBrowserSignIn({
    destination: '/admin/dashboard',
    startedTitle: t('auth.trustedDevice.eyebrow.admin', {}, 'Admin access'),
    startedDetail: t(
      'profile.settings.devices.adminBody',
      {},
      'Admin access accepts only verified, user-verified passkeys. A remembered browser improves recognition but never satisfies admin MFA.'
    ),
    providerLabel: 'desktop admin browser',
  });

  const handleReopenDesktopBrowserSignIn = async () => {
    if (!desktopBrowserRequestId || typeof reopenDesktopBrowserSignIn !== 'function') {
      setErr({ message: t('login.desktopBrowser.unavailable', {}, 'Desktop browser sign-in is available only in the Aura desktop app.') });
      return;
    }

    try {
      await reopenDesktopBrowserSignIn(desktopBrowserRequestId);
      setAuthError(null);
      setAuthSuccess({
        title: t('login.desktopBrowser.startedTitle', {}, 'Continue in Your Browser'),
        detail: t('login.desktopBrowser.startedDetail', {}, 'In the browser, enter your password and complete the email and phone codes. Aura Desktop will wait for up to 10 minutes.'),
      });
    } catch (error) {
      setErr(error);
    }
  };

  const handleCancelDesktopBrowserSignIn = () => {
    desktopBrowserAbortControllerRef.current?.abort();
  };

  const handleDesktopBrowserConsent = async () => {
    if (!desktopBrowserHandoff.active || desktopBrowserConsentSubmitting) {
      return;
    }

    const consentHandoffKey = desktopBrowserHandoffKey;
    if (!consentHandoffKey) {
      return;
    }

    setAuthError(null);
    setAuthSuccess(null);
    setDesktopBrowserConsentSubmitting(true);
    try {
      if (!desktopBrowserConsentReady) {
        desktopBrowserHandoffPreflightAttemptRef.current = '';
        setDesktopBrowserHandoffPreflightFailed(false);
        setDesktopBrowserConsentStage('preflight');
        await runDesktopBrowserHandoffPreflight({ handoffKey: consentHandoffKey });
        if (desktopBrowserHandoffKeyRef.current === consentHandoffKey) {
          setDesktopBrowserConsentSubmitting(false);
          setDesktopBrowserConsentStage('idle');
        }
        return;
      }

      if (desktopBrowserHandoffKeyRef.current !== consentHandoffKey) {
        return;
      }
      setDesktopBrowserConsentStage('handoff');
      setDesktopBrowserConsentGrantedKey(consentHandoffKey);
    } catch (error) {
      if (desktopBrowserHandoffKeyRef.current !== consentHandoffKey) {
        return;
      }
      setDesktopBrowserConsentStage('idle');
      setDesktopBrowserConsentSubmitting(false);
      setAuthSuccess(null);
      setErr(error);
    }
  };

  const completeDesktopBrowserHandoffCheckpoint = async (verify) => {
    const handoffKey = desktopBrowserHandoffKey;
    if (!handoffKey || typeof verify !== 'function') {
      throw new Error('The desktop sign-in checkpoint is no longer available. Start again from Aura Desktop.');
    }

    setAuthError(null);
    setAuthSuccess(null);
    setDesktopBrowserConsentSubmitting(true);
    setDesktopBrowserConsentStage('preflight');
    try {
      const response = await verify();
      if (desktopBrowserHandoffKeyRef.current !== handoffKey) {
        return response;
      }
      cacheDesktopBrowserTrustedDeviceSession(response);
      desktopBrowserHandoffPreflightAttemptRef.current = '';
      setDesktopBrowserHandoffPreflight(null);
      setDesktopBrowserHandoffPreflightReadyKey('');
      setDesktopBrowserHandoffPreflightFailed(false);
      await runDesktopBrowserHandoffPreflight({ handoffKey });
      return response;
    } catch (error) {
      if (desktopBrowserHandoffKeyRef.current === handoffKey) {
        setDesktopBrowserHandoffPreflightFailed(true);
        setErr(error);
      }
      throw error;
    } finally {
      if (desktopBrowserHandoffKeyRef.current === handoffKey) {
        setDesktopBrowserConsentSubmitting(false);
        setDesktopBrowserConsentStage('idle');
      }
    }
  };

  const handleDesktopBrowserDeviceChallenge = async (token, signedChallenge) => (
    completeDesktopBrowserHandoffCheckpoint(() => authApi.verifyDeviceChallenge(
      token,
      signedChallenge,
      '',
      getDesktopBrowserHandoffAuthOptions()
    ))
  );

  const handleDesktopBrowserMfaPasskey = async (input = {}) => (
    completeDesktopBrowserHandoffCheckpoint(() => authApi.verifyMfaPasskeyLogin(
      input,
      getDesktopBrowserHandoffAuthOptions()
    ))
  );

  const handleDesktopBrowserMfaTotp = async (input = {}) => (
    completeDesktopBrowserHandoffCheckpoint(() => authApi.verifyTotpLogin(
      input,
      getDesktopBrowserHandoffAuthOptions()
    ))
  );

  const handleDesktopBrowserMfaRecoveryCode = async (input = {}) => (
    completeDesktopBrowserHandoffCheckpoint(() => authApi.verifyMfaRecoveryCode(
      input,
      getDesktopBrowserHandoffAuthOptions()
    ))
  );

  const handleDesktopBrowserConsentCancel = () => {
    if (!desktopBrowserHandoff.active || desktopBrowserConsentSubmitting) {
      return;
    }

    setAuthError(null);
    setDesktopBrowserConsentSubmitting(true);

    try {
      submitDesktopBrowserHandoffCancellation({
        callbackUrl: desktopBrowserHandoff.callbackUrl,
        requestId: desktopBrowserHandoff.requestId,
        secret: desktopBrowserHandoff.secret,
      });
      clearStoredDesktopBrowserHandoff(desktopBrowserHandoff.requestId);
    } catch (error) {
      setDesktopBrowserConsentSubmitting(false);
      setErr(error);
    }
  };

  const handleDesktopBrowserUseAnotherAccount = async () => {
    if (!desktopBrowserHandoff.active || desktopBrowserConsentSubmitting || typeof logout !== 'function') {
      return;
    }

    setAuthError(null);
    setAuthSuccess(null);
    setDesktopBrowserConsentGrantedKey('');
    setDesktopBrowserHandoffPreflight(null);
    setDesktopBrowserHandoffPreflightReadyKey('');
    setDesktopBrowserHandoffPreflightFailed(false);
    desktopBrowserHandoffPreflightAttemptRef.current = '';

    try {
      await logout();
    } catch (error) {
      setErr(error);
    }
  };

  const handleDesktopOwnerAccessSignIn = async () => {
    if (!canUseDesktopOwnerAccessSignIn) {
      setErr({ message: t('login.desktopOwnerAccess.unavailable', {}, 'Desktop owner access is not configured for this app.') });
      return;
    }

    setIsLoading(true);
    setAuthError(null);
    setAuthSuccess({
      title: t('login.desktopOwnerAccess.startedTitle', {}, 'Owner Access'),
      detail: t('login.desktopOwnerAccess.startedDetail', {}, 'Aura Desktop is verifying the local owner access key.'),
    });

    try {
      const result = await signInWithDesktopOwnerAccess();
      if (!result?.redirecting) {
        finishAuthAndNavigate(resolveAuthSuccess('signin_success', t));
      }
    } catch (error) {
      setAuthSuccess(null);
      setErr(normalizeSocialAuthError(error, 'desktop owner access', socialAuthStatus));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDuoSignIn = async () => {
    setIsLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      let returnTo = duoReturnTo;
      if (desktopBrowserHandoff.active) {
        const stored = persistDesktopBrowserHandoff(desktopBrowserHandoff);
        if (!stored) {
          throw new Error(t('login.desktopBrowser.storageUnavailable', {}, 'Desktop Duo sign-in could not arm the secure browser bridge. Please refresh from Aura Desktop and try again.'));
        }
        returnTo = buildDesktopDuoReturnTo(desktopBrowserHandoff.requestId);
      }
      authApi.startDuoLogin({
        returnTo,
      });
    } catch (error) {
      setIsLoading(false);
      setErr(error);
    }
  };

  const submitLabel = useMemo(() => {
    if (step === 'reset-password') return t('login.submit.reset', {}, 'RESET PASSWORD');

    if (step === 'otp') {
      if (isEmailOtpStage) return t('login.submit.verifyEmail', {}, 'VERIFY EMAIL CODE');
      if (isPhoneOtpStage) {
        if (mode === 'signup') return t('login.submit.verifyPhoneCreate', {}, 'VERIFY PHONE & CREATE ACCOUNT');
        if (mode === 'forgot-password') return t('login.submit.verifyPhoneContinue', {}, 'VERIFY PHONE & CONTINUE');
        return t('login.submit.verifyPhoneSignin', {}, 'VERIFY PHONE & SIGN IN');
      }
      return mode === 'signin' ? t('login.submit.verifyOtpSignin', {}, 'VERIFY OTP & SIGN IN') : t('login.submit.verifyOtp', {}, 'VERIFY OTP');
    }

    if (firebasePhoneFallback?.disableFirebasePhoneOtp) return t('login.submit.sendBackupOtp', {}, 'SEND BACKUP OTP');
    if (mode === 'signup') return canUseFirebasePhoneOtp ? t('login.submit.sendDualOtp', {}, 'SEND EMAIL + PHONE OTP') : t('login.submit.sendOtpSignup', {}, 'SEND OTP & SIGN UP');
    if (mode === 'forgot-password') return canUseFirebasePhoneOtp ? t('login.submit.sendDualOtp', {}, 'SEND EMAIL + PHONE OTP') : t('login.submit.sendOtp', {}, 'SEND OTP');
    return canUseFirebasePhoneOtp ? t('login.submit.sendDualOtp', {}, 'SEND EMAIL + PHONE OTP') : t('login.submit.sendOtpSignin', {}, 'SEND OTP & SIGN IN');
  }, [canUseFirebasePhoneOtp, firebasePhoneFallback?.disableFirebasePhoneOtp, isEmailOtpStage, isPhoneOtpStage, mode, step, t]);

  const turnstileAction = useMemo(() => {
    if (step === 'reset-password') return 'auth_reset_password';
    if (step === 'otp') {
      if (isEmailOtpStage) return 'auth_otp_verify_email';
      if (isPhoneOtpStage) return mode === 'signin' ? 'auth_phone_verify' : 'auth_bootstrap_device';
      return 'auth_otp_verify';
    }
    if (mode === 'forgot-password') return 'auth_otp_send_recovery';
    if (mode === 'signup') return 'auth_otp_send_signup';
    return 'auth_otp_send_signin';
  }, [isEmailOtpStage, isPhoneOtpStage, mode, step]);

  const isSessionCheckpointPending = (
    sessionStatus === 'device_challenge_required'
    || sessionStatus === 'mfa_challenge_required'
  );

  return {
    OTP_TRANSPORT,
    accelerationCards,
    authError,
    authSuccess,
    canUseFirebasePhoneOtp,
    canUseDesktopBrowserSignIn,
    canUseDesktopOwnerAccessSignIn,
    countdown,
    desktopBrowserHandoff,
    desktopBrowserHandoffCheckpoint,
    desktopBrowserHandoffPreflightFailed,
    desktopBrowserConsentIdentity,
    desktopBrowserConsentActionLabel,
    desktopBrowserConsentReady,
    desktopBrowserConsentStage,
    desktopBrowserConsentSubmitting,
    desktopBrowserConsentSubmittingLabel,
    desktopBrowserSessionHydrating,
    desktopBrowserSignInPending,
    firebasePhoneFallback,
    formData,
    goBack,
    handleChange,
    handleFeedbackAction,
    handlePhoneChange,
    handlePhoneCountryChange,
    handleOtpChange,
    handleOtpKeyDown,
    handleOtpPaste,
    handleResendOtp,
    handleDuoSignIn,
    isDuoLoginEnabled,
    handleDesktopAdminSignIn,
    handleDesktopBrowserSignIn,
    handleReopenDesktopBrowserSignIn,
    handleCancelDesktopBrowserSignIn,
    handleDesktopBrowserConsent,
    handleDesktopBrowserConsentCancel,
    handleDesktopBrowserUseAnotherAccount,
    handleDesktopBrowserDeviceChallenge,
    handleDesktopBrowserMfaPasskey,
    handleDesktopBrowserMfaTotp,
    handleDesktopBrowserMfaRecoveryCode,
    handleDesktopOwnerAccessSignIn,
    handleSocialSignIn,
    handleSubmit,
    info,
    isEmailOtpStage,
    isLoading,
    isSessionCheckpointPending,
    isPhoneOtpStage,
    mode,
    otpRefs,
    otpTransport,
    otpValues,
    phoneCountryCode,
    phoneCountryOptions,
    phoneLocalValue,
    recaptchaContainerRef,
    secureSignals,
    selectedPhoneCountry,
    setShowPassword,
    showPassword,
    signInWithFacebook,
    signInWithGitHub,
    signInWithGoogle,
    signInWithMicrosoft,
    signInWithApple,
    signInWithX,
    socialAuthStatus,
    sessionStatus,
    step,
    submitLabel,
    switchMode,
    t,
    trustNotes,
    turnstileAction,
    turnstileEnabled,
    turnstileRefreshKey,
    handleTurnstileError,
    handleTurnstileToken,
  };
};
