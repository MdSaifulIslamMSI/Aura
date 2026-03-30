const DEVICE_ID_STORAGE_KEY = 'aura_trusted_device_id_v1';
const DEVICE_SESSION_STORAGE_KEY = 'aura_trusted_device_session_v1';
const DEVICE_DB_NAME = 'aura_trusted_device_keys';
const DEVICE_STORE_NAME = 'keys';

let keyDbPromise = null;
let inMemoryDeviceId = '';

const hasWindow = () => typeof window !== 'undefined';

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
  const storage = readStorage('sessionStorage');
  return storage?.getItem(DEVICE_SESSION_STORAGE_KEY) || '';
};

export const cacheTrustedDeviceSessionToken = (token = '') => {
  const storage = readStorage('sessionStorage');
  if (!storage) return;

  if (token) {
    storage.setItem(DEVICE_SESSION_STORAGE_KEY, token);
    return;
  }

  storage.removeItem(DEVICE_SESSION_STORAGE_KEY);
};

export const clearTrustedDeviceSessionToken = () => {
  cacheTrustedDeviceSessionToken('');
};

export const isTrustedDeviceSupported = () => Boolean(
  hasWindow()
  && window.isSecureContext
  && window.crypto?.subtle
  && window.indexedDB
);

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

export const signTrustedDeviceChallenge = async (challenge = {}) => {
  if (!isTrustedDeviceSupported()) {
    throw new Error('Trusted device verification requires a secure browser with WebCrypto and IndexedDB support.');
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

  return {
    'X-Aura-Device-Id': deviceId,
    'X-Aura-Device-Label': getTrustedDeviceLabel(),
    ...(deviceSessionToken ? { 'X-Aura-Device-Session': deviceSessionToken } : {}),
  };
};
