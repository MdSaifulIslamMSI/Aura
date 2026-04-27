import { getSafeEnv } from './runtimeApiConfig';
import { isCapacitorNativeRuntime } from '../utils/nativeRuntime';

const DEVICE_ID_STORAGE_KEY = 'aura_trusted_device_id_v1';
const DEVICE_SESSION_STORAGE_KEY = 'aura_trusted_device_session_v1';
const DEVICE_DB_NAME = 'aura_trusted_device_keys';
const DEVICE_STORE_NAME = 'keys';
const CLIENT_ORIGIN_HEADER = 'X-Aura-Client-Origin';

let keyDbPromise = null;
let inMemoryDeviceId = '';

const hasWindow = () => typeof window !== 'undefined';

const normalizeHost = (value = '') => String(value || '').trim().toLowerCase();

const normalizeTrustedDeviceMethod = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'webauthn' || normalized === 'browser_key'
    ? normalized
    : '';
};

const parseBooleanEnv = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const getRuntimeHost = () => {
  if (!hasWindow()) return '';
  return normalizeHost(window.location?.hostname || window.location?.host || '');
};

const isElectronDesktopRuntime = () => {
  if (!hasWindow()) return false;
  if (window.auraDesktop?.isDesktop) return true;
  return /\bElectron\//i.test(String(window.navigator?.userAgent || ''));
};

const shouldPersistTrustedDeviceSession = () => {
  const configuredValue = getSafeEnv('VITE_PERSIST_TRUSTED_DEVICE_SESSION', '');
  if (String(configuredValue || '').trim() !== '') {
    return parseBooleanEnv(configuredValue, false);
  }

  return isElectronDesktopRuntime()
    || isCapacitorNativeRuntime();
};

const getPlatformPasskeyLabel = () => {
  if (!hasWindow()) return 'Face ID / Windows Hello passkey';

  const platform = String(
    window.navigator?.userAgentData?.platform
    || window.navigator?.platform
    || ''
  ).toLowerCase();
  const userAgent = String(window.navigator?.userAgent || '').toLowerCase();
  const fingerprint = `${platform} ${userAgent}`;

  if (/iphone|ipad|ipod/.test(fingerprint)) return 'Face ID / Touch ID passkey';
  if (/mac/.test(fingerprint)) return 'Touch ID / passkey';
  if (/win/.test(fingerprint)) return 'Windows Hello passkey';
  if (/android/.test(fingerprint)) return 'Android biometric passkey';
  return 'Face ID / Windows Hello passkey';
};

const isIpv4Host = (host = '') => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);

const isIpv6Host = (host = '') => {
  const normalized = normalizeHost(host);
  return Boolean(
    normalized
    && !normalized.includes('.')
    && (normalized.includes(':') || normalized.startsWith('[') || normalized.endsWith(']'))
  );
};

const isIpLiteralHost = (host = '') => isIpv4Host(host) || isIpv6Host(host);

const isRegistrableHost = (host = '') => {
  const normalized = normalizeHost(host);
  if (!normalized || normalized === 'localhost' || isIpLiteralHost(normalized)) {
    return false;
  }

  const labels = normalized.split('.').filter(Boolean);
  if (labels.length < 2) return false;

  return labels.every((label) => /^[a-z0-9-]+$/i.test(label) && !label.startsWith('-') && !label.endsWith('-'))
    && /[a-z]/i.test(labels[labels.length - 1] || '');
};

const readStorage = (kind = 'localStorage') => {
  if (!hasWindow()) return null;
  try {
    return window[kind] || null;
  } catch {
    return null;
  }
};

const toBase64 = (input) => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
};

const toBase64Url = (input) => toBase64(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const fromBase64Url = (value = '') => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const ensureIndexedDb = () => {
  if (!hasWindow() || !window.indexedDB) {
    throw new Error('Trusted device storage requires IndexedDB support.');
  }
  return window.indexedDB;
};

const openKeyDatabase = () => {
  if (keyDbPromise) return keyDbPromise;

  keyDbPromise = new Promise((resolve, reject) => {
    let request;

    try {
      request = ensureIndexedDb().open(DEVICE_DB_NAME, 1);
    } catch (error) {
      reject(error);
      return;
    }

    request.onerror = () => reject(request.error || new Error('Unable to open trusted device storage.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DEVICE_STORE_NAME)) {
        db.createObjectStore(DEVICE_STORE_NAME, { keyPath: 'deviceId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

  return keyDbPromise;
};

const readKeyRecord = async (deviceId) => {
  const db = await openKeyDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DEVICE_STORE_NAME, 'readonly');
    const store = tx.objectStore(DEVICE_STORE_NAME);
    const request = store.get(deviceId);
    request.onerror = () => reject(request.error || new Error('Unable to read trusted device key.'));
    request.onsuccess = () => resolve(request.result || null);
  });
};

const writeKeyRecord = async (record) => {
  const db = await openKeyDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DEVICE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(DEVICE_STORE_NAME);
    const request = store.put(record);
    request.onerror = () => reject(request.error || new Error('Unable to store trusted device key.'));
    request.onsuccess = () => resolve(record);
  });
};

const deleteKeyRecord = async (deviceId) => {
  const db = await openKeyDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DEVICE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(DEVICE_STORE_NAME);
    const request = store.delete(deviceId);
    request.onerror = () => reject(request.error || new Error('Unable to remove trusted device key.'));
    request.onsuccess = () => resolve();
  });
};

const generateDeviceId = () => {
  if (hasWindow() && window.crypto?.randomUUID) {
    return `aura_${window.crypto.randomUUID().replace(/-/g, '_')}`;
  }
  return `aura_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
};

export const getTrustedDeviceId = () => {
  const storage = readStorage('localStorage');
  if (storage) {
    const existing = storage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;

    const generated = generateDeviceId();
    storage.setItem(DEVICE_ID_STORAGE_KEY, generated);
    return generated;
  }

  if (!inMemoryDeviceId) {
    inMemoryDeviceId = generateDeviceId();
  }
  return inMemoryDeviceId;
};

export const getTrustedDeviceLabel = () => {
  if (!hasWindow()) return 'Trusted browser';

  const platform = window.navigator?.userAgentData?.platform
    || window.navigator?.platform
    || '';
  const appCodeName = window.navigator?.appCodeName || '';
  const label = [platform, appCodeName].filter(Boolean).join(' ').trim();
  return (label || 'Trusted browser').slice(0, 120);
};

export const getTrustedDeviceSessionToken = () => {
  const tabStorage = readStorage('sessionStorage');
  const sharedStorage = shouldPersistTrustedDeviceSession() ? readStorage('localStorage') : null;
  const tabToken = tabStorage?.getItem(DEVICE_SESSION_STORAGE_KEY) || '';
  if (tabToken) {
    if (sharedStorage && sharedStorage.getItem(DEVICE_SESSION_STORAGE_KEY) !== tabToken) {
      sharedStorage.setItem(DEVICE_SESSION_STORAGE_KEY, tabToken);
    }
    return tabToken;
  }
  return sharedStorage?.getItem(DEVICE_SESSION_STORAGE_KEY) || '';
};

export const cacheTrustedDeviceSessionToken = (token = '') => {
  const tabStorage = readStorage('sessionStorage');
  const sharedStorage = shouldPersistTrustedDeviceSession() ? readStorage('localStorage') : null;

  if (token) {
    tabStorage?.setItem(DEVICE_SESSION_STORAGE_KEY, token);
    sharedStorage?.setItem(DEVICE_SESSION_STORAGE_KEY, token);
    return;
  }

  tabStorage?.removeItem(DEVICE_SESSION_STORAGE_KEY);
  sharedStorage?.removeItem(DEVICE_SESSION_STORAGE_KEY);
};

export const clearTrustedDeviceSessionToken = () => {
  cacheTrustedDeviceSessionToken('');
};

export const getTrustedDeviceClientOrigin = () => {
  if (!hasWindow()) return '';

  const explicitOrigin = String(window.location?.origin || '').trim();
  if (explicitOrigin) return explicitOrigin;

  const protocol = String(window.location?.protocol || '').trim();
  const host = String(window.location?.host || '').trim();
  if (!host) return '';

  return `${protocol || 'https:'}//${host}`;
};

export const isTrustedDeviceSupported = () => Boolean(
  hasWindow()
  && window.isSecureContext
  && (
    (window.PublicKeyCredential && window.navigator?.credentials)
    || (window.crypto?.subtle && window.indexedDB)
  )
);

export const isWebAuthnSupported = () => Boolean(
  hasWindow()
  && window.isSecureContext
  && window.PublicKeyCredential
  && window.navigator?.credentials
);

const canUseBrowserKeyFallback = () => Boolean(
  hasWindow()
  && window.isSecureContext
  && window.crypto?.subtle
  && window.indexedDB
);

export const getTrustedDeviceSupportProfile = () => {
  const runtimeHost = getRuntimeHost();
  return {
    webauthn: isWebAuthnSupported(),
    browserKeyFallback: canUseBrowserKeyFallback(),
    biometricPasskeyLabel: getPlatformPasskeyLabel(),
    runtimeHost,
    webauthnHostEligible: runtimeHost === 'localhost' || isRegistrableHost(runtimeHost),
    localIpHost: isIpLiteralHost(runtimeHost),
  };
};

const exportPublicKey = async (publicKey) => {
  const spki = await window.crypto.subtle.exportKey('spki', publicKey);
  return toBase64(spki);
};

const createTrustedDeviceKeyPair = async (deviceId) => {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'RSA-PSS',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    false,
    ['sign', 'verify']
  );

  const publicKeySpkiBase64 = await exportPublicKey(keyPair.publicKey);
  const record = {
    deviceId,
    privateKey: keyPair.privateKey,
    publicKeySpkiBase64,
    createdAt: Date.now(),
  };

  await writeKeyRecord(record);
  return record;
};

const getExistingTrustedDeviceKey = async (deviceId) => {
  const record = await readKeyRecord(deviceId);
  return record?.privateKey ? record : null;
};

const getOrCreateTrustedDeviceKey = async (deviceId) => {
  const existing = await getExistingTrustedDeviceKey(deviceId);
  if (existing) return existing;
  return createTrustedDeviceKeyPair(deviceId);
};

const buildChallengeMessage = ({ challenge = '', mode = '', deviceId = '' } = {}) => (
  new TextEncoder().encode(`aura-device-proof|${mode}|${deviceId}|${challenge}`)
);

const normalizeWebAuthnCredentialDescriptor = (credential = {}) => ({
  ...credential,
  id: fromBase64Url(credential.id || credential.rawId || ''),
});

const toCreationOptions = (options = {}) => ({
  ...options,
  challenge: fromBase64Url(options.challenge || ''),
  user: {
    ...(options.user || {}),
    id: fromBase64Url(options.user?.id || ''),
  },
  authenticatorSelection: {
    ...(options.authenticatorSelection || {}),
    authenticatorAttachment: options.authenticatorSelection?.authenticatorAttachment || 'platform',
    userVerification: 'required',
  },
  excludeCredentials: Array.isArray(options.excludeCredentials)
    ? options.excludeCredentials.map((credential) => normalizeWebAuthnCredentialDescriptor(credential))
    : [],
});

const toAssertionOptions = (options = {}) => ({
  ...options,
  challenge: fromBase64Url(options.challenge || ''),
  userVerification: 'required',
  allowCredentials: Array.isArray(options.allowCredentials)
    ? options.allowCredentials.map((credential) => normalizeWebAuthnCredentialDescriptor(credential))
    : [],
});

const serializePasskeyRegistration = (credential, deviceId) => ({
  method: 'webauthn',
  deviceId,
  deviceLabel: getTrustedDeviceLabel(),
  credential: {
    id: credential.id,
    rawIdBase64Url: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || '',
    response: {
      clientDataJSONBase64Url: toBase64Url(credential.response.clientDataJSON),
      attestationObjectBase64Url: toBase64Url(credential.response.attestationObject),
      transports: typeof credential.response.getTransports === 'function'
        ? credential.response.getTransports()
        : [],
    },
  },
});

const serializePasskeyAssertion = (credential, deviceId) => ({
  method: 'webauthn',
  deviceId,
  deviceLabel: getTrustedDeviceLabel(),
  credential: {
    id: credential.id,
    rawIdBase64Url: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || '',
    response: {
      clientDataJSONBase64Url: toBase64Url(credential.response.clientDataJSON),
      authenticatorDataBase64Url: toBase64Url(credential.response.authenticatorData),
      signatureBase64Url: toBase64Url(credential.response.signature),
      userHandleBase64Url: credential.response.userHandle
        ? toBase64Url(credential.response.userHandle)
        : '',
    },
  },
});

const shouldFallbackFromWebAuthn = (error) => {
  const errorName = String(error?.name || '');
  const errorMessage = String(error?.message || '').toLowerCase();
  return errorName === 'NotSupportedError'
    || errorName === 'SecurityError'
    || errorMessage.includes('securityerror')
    || errorMessage.includes('publickeycredential is not defined')
    || errorMessage.includes('not supported')
    || errorMessage.includes('relying party id')
    || errorMessage.includes('registrable domain suffix')
    || errorMessage.includes('.well-known/webauthn')
    || errorMessage.includes('claimed rp id')
    || errorMessage.includes('webauthn resource')
    || errorMessage.includes('origin mismatch');
};

const runWebAuthnEnrollment = async (challenge = {}) => {
  if (!isWebAuthnSupported()) {
    throw new Error('Passkey verification requires a WebAuthn-capable secure browser.');
  }

  const options = challenge?.webauthn?.registrationOptions;
  if (!options) {
    throw new Error('Passkey enrollment options are missing for this challenge.');
  }

  const credential = await window.navigator.credentials.create({
    publicKey: toCreationOptions(options),
  });

  if (!credential) {
    throw new Error('Passkey enrollment did not return a credential.');
  }

  return serializePasskeyRegistration(credential, getTrustedDeviceId());
};

const runWebAuthnAssertion = async (challenge = {}) => {
  if (!isWebAuthnSupported()) {
    throw new Error('Passkey verification requires a WebAuthn-capable secure browser.');
  }

  const options = challenge?.webauthn?.assertionOptions;
  if (!options) {
    throw new Error('Passkey assertion options are missing for this challenge.');
  }

  const credential = await window.navigator.credentials.get({
    publicKey: toAssertionOptions(options),
  });

  if (!credential) {
    throw new Error('Passkey verification did not return a credential.');
  }

  return serializePasskeyAssertion(credential, getTrustedDeviceId());
};

export const signTrustedDeviceChallenge = async (challenge = {}, options = {}) => {
  if (!isTrustedDeviceSupported()) {
    throw new Error('Trusted device verification requires a secure browser with WebCrypto and IndexedDB support.');
  }

  const availableMethods = Array.isArray(challenge?.availableMethods)
    ? challenge.availableMethods.map((method) => String(method || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const selectedMethod = normalizeTrustedDeviceMethod(options?.preferredMethod);
  const challengeAllowsMethod = (method) => !availableMethods.length || availableMethods.includes(method);

  if (selectedMethod === 'webauthn' && !challengeAllowsMethod('webauthn')) {
    throw new Error('Passkey verification is not available for this challenge.');
  }

  if (selectedMethod === 'browser_key' && !challengeAllowsMethod('browser_key')) {
    throw new Error('RSA-PSS browser-key verification is not available for this challenge.');
  }

  const shouldTryWebAuthn = selectedMethod
    ? selectedMethod === 'webauthn'
    : challengeAllowsMethod('webauthn') && isWebAuthnSupported();

  if (shouldTryWebAuthn) {
    try {
      return challenge?.mode === 'enroll'
        ? await runWebAuthnEnrollment(challenge)
        : await runWebAuthnAssertion(challenge);
    } catch (error) {
      if (selectedMethod === 'webauthn') {
        throw error;
      }

      if (!challengeAllowsMethod('browser_key') || !shouldFallbackFromWebAuthn(error)) {
        throw error;
      }
    }
  }

  if (selectedMethod === 'webauthn') {
    throw new Error('Passkey verification is not available for this challenge.');
  }

  if (!canUseBrowserKeyFallback()) {
    throw new Error('Trusted device verification requires a secure browser with WebAuthn or WebCrypto support.');
  }

  const deviceId = getTrustedDeviceId();
  const mode = String(challenge?.mode || '').trim();
  const keyRecord = mode === 'enroll'
    ? await getOrCreateTrustedDeviceKey(deviceId)
    : await getExistingTrustedDeviceKey(deviceId);

  if (!keyRecord?.privateKey) {
    const error = new Error('Trusted device key is missing on this browser. Reset this browser identity and try again.');
    error.code = 'trusted_device_key_missing';
    throw error;
  }

  const signature = await window.crypto.subtle.sign(
    { name: 'RSA-PSS', saltLength: 32 },
    keyRecord.privateKey,
    buildChallengeMessage({
      challenge: challenge.challenge,
      mode,
      deviceId,
    })
  );

  return {
    method: 'browser_key',
    deviceId,
    deviceLabel: getTrustedDeviceLabel(),
    proofBase64: toBase64(signature),
    publicKeySpkiBase64: mode === 'enroll' ? keyRecord.publicKeySpkiBase64 : '',
  };
};

export const resetTrustedDeviceIdentity = async () => {
  const storage = readStorage('localStorage');
  const deviceId = storage?.getItem(DEVICE_ID_STORAGE_KEY) || inMemoryDeviceId || '';
  storage?.removeItem(DEVICE_ID_STORAGE_KEY);
  clearTrustedDeviceSessionToken();
  inMemoryDeviceId = '';

  try {
    if (deviceId) {
      await deleteKeyRecord(deviceId);
    }
  } catch {
    // best-effort cleanup
  }
};

export const getTrustedDeviceHeaders = () => {
  const deviceId = getTrustedDeviceId();
  const deviceSessionToken = getTrustedDeviceSessionToken();
  const clientOrigin = getTrustedDeviceClientOrigin();

  return {
    'X-Aura-Device-Id': deviceId,
    'X-Aura-Device-Label': getTrustedDeviceLabel(),
    ...(clientOrigin ? { [CLIENT_ORIGIN_HEADER]: clientOrigin } : {}),
    ...(deviceSessionToken ? { 'X-Aura-Device-Session': deviceSessionToken } : {}),
  };
};
