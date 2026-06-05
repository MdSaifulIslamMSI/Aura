import { apiFetch } from '../services/apiBase';
import { getAuthHeader } from '../services/api/apiUtils';
import {
  addCsrfTokenToHeaders,
  ensureCsrfToken,
} from '../services/csrfTokenManager';
import {
  getTrustedDeviceHeaders,
  signTrustedDeviceChallenge,
} from '../services/deviceTrustClient';

const ALIEN_PROOF_HEADERS = Object.freeze({
  challengeId: 'X-Alien-OTP-Challenge-Id',
  action: 'X-Alien-OTP-Action',
  resource: 'X-Alien-OTP-Resource',
  proof: 'X-Alien-OTP-Proof',
});

const parseBooleanEnv = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

export const isAlienOtpClientEnabled = () => parseBooleanEnv(import.meta.env?.VITE_ALIEN_OTP_ENABLED, false);

const normalizeText = (value = '') => String(value || '').trim();

const encodeProofHeader = (proof = {}) => {
  const json = JSON.stringify(proof);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const buildDeviceChallenge = (challenge = {}) => ({
  challenge: challenge.publicChallenge,
  mode: 'assert',
  availableMethods: ['webauthn'],
  webauthn: {
    assertionOptions: challenge.webauthnOptions,
  },
});

const hasBearerAuth = (headers = {}) => {
  const value = headers.Authorization || headers.authorization || '';
  return /^Bearer\s+\S+/i.test(String(value || '').trim());
};

const buildChallengeRequestHeaders = async (options = {}) => {
  const authHeaders = await getAuthHeader(options.firebaseUser || null, {
    useFirebaseBearer: options.useFirebaseBearer,
    forceRefresh: options.forceRefreshAuth === true,
  });
  const headers = {
    ...authHeaders,
    ...(options.headers || {}),
  };

  if (hasBearerAuth(headers) || options.skipCsrf === true) {
    return headers;
  }

  const csrfToken = await ensureCsrfToken({
    owner: options.csrfOwner || 'cookie_session',
    forceFresh: options.forceFreshCsrf === true,
  });
  return addCsrfTokenToHeaders(headers, 'POST', csrfToken);
};

export const requestAlienChallenge = async ({ action = '', resourceId = '' } = {}, options = {}) => {
  const normalizedAction = normalizeText(action);
  if (!normalizedAction) {
    throw new Error('ALIEN OTP action is required.');
  }

  const headers = await buildChallengeRequestHeaders(options);
  const { data } = await apiFetch('/security/alien-otp/challenge', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: normalizedAction,
      resourceId: normalizeText(resourceId),
    }),
  });

  return data;
};

export const signAlienChallengeWithPasskey = async ({ challenge } = {}, options = {}) => {
  if (!challenge?.challengeId || !challenge?.publicChallenge) {
    throw new Error('ALIEN OTP challenge is incomplete.');
  }
  if (!challenge?.webauthnOptions) {
    const error = new Error('ALIEN OTP passkey proof is unavailable; use the existing MFA step-up fallback.');
    error.fallback = challenge?.fallback || 'existing_mfa_step_up';
    throw error;
  }

  const proof = await signTrustedDeviceChallenge(buildDeviceChallenge(challenge), {
    preferredMethod: options.preferredMethod || 'webauthn',
  });
  if (proof?.method !== 'webauthn' || !proof?.credential) {
    const error = new Error('ALIEN OTP requires a passkey assertion for this proof.');
    error.fallback = 'existing_mfa_step_up';
    throw error;
  }

  return {
    method: 'webauthn',
    deviceId: proof.deviceId || '',
    deviceLabel: proof.deviceLabel || '',
    credential: proof.credential,
  };
};

export const attachAlienProof = async ({
  request = {},
  action = '',
  resourceId = '',
  challenge: existingChallenge = null,
} = {}) => {
  if (!isAlienOtpClientEnabled()) {
    return request;
  }

  const challenge = existingChallenge || await requestAlienChallenge({ action, resourceId });
  const proof = await signAlienChallengeWithPasskey({ challenge });
  const headers = new Headers(request.headers || {});

  Object.entries(getTrustedDeviceHeaders()).forEach(([key, value]) => {
    if (value && !headers.has(key)) headers.set(key, value);
  });
  headers.set(ALIEN_PROOF_HEADERS.challengeId, challenge.challengeId);
  headers.set(ALIEN_PROOF_HEADERS.action, normalizeText(action));
  headers.set(ALIEN_PROOF_HEADERS.resource, normalizeText(resourceId));
  headers.set(ALIEN_PROOF_HEADERS.proof, encodeProofHeader(proof));

  return {
    ...request,
    headers,
    alienOtpChallenge: challenge,
  };
};

export default {
  attachAlienProof,
  isAlienOtpClientEnabled,
  requestAlienChallenge,
  signAlienChallengeWithPasskey,
};
