const KNOWN_SESSION_INDEXED_DB_NAMES = [
  'aura_trusted_device_keys',
  'aura_dpop_keys',
  'firebaseLocalStorageDb',
  'firebase-heartbeat-database',
  'firebase-installations-database',
];

const getWindowRef = () => (
  typeof window !== 'undefined' ? window : null
);

const isAppIndexedDbName = (name = '') => {
  const normalized = String(name || '').trim().toLowerCase();
  return normalized.startsWith('aura')
    || normalized.includes('firebase');
};

export const clearStorageArea = (storage) => {
  if (!storage) return [];

  const clearedKeys = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) clearedKeys.push(key);
    }

    storage.clear();
  } catch {
    // Best-effort browser recovery. Other reset steps should still run.
  }

  return clearedKeys;
};

export const clearCacheStorage = async (cacheStorage) => {
  if (!cacheStorage || typeof cacheStorage.keys !== 'function') {
    return [];
  }

  try {
    const cacheKeys = await cacheStorage.keys();
    await Promise.all(cacheKeys.map(async (key) => {
      try {
        await cacheStorage.delete(key);
      } catch {
        // Continue clearing the rest of the origin cache.
      }
    }));
    return cacheKeys;
  } catch {
    return [];
  }
};

export const unregisterServiceWorkers = async (serviceWorkerContainer) => {
  if (!serviceWorkerContainer || typeof serviceWorkerContainer.getRegistrations !== 'function') {
    return [];
  }

  try {
    const registrations = await serviceWorkerContainer.getRegistrations();
    await Promise.all(registrations.map(async (registration) => {
      try {
        if (typeof registration?.unregister === 'function') {
          await registration.unregister();
        }
      } catch {
        // Keep the reset path moving even if one registration is already gone.
      }
    }));
    return registrations;
  } catch {
    return [];
  }
};

const getIndexedDbNames = async (indexedDBRef) => {
  const names = new Set(KNOWN_SESSION_INDEXED_DB_NAMES);

  if (indexedDBRef && typeof indexedDBRef.databases === 'function') {
    try {
      const databases = await indexedDBRef.databases();
      for (const database of databases || []) {
        const name = String(database?.name || '').trim();
        if (name && isAppIndexedDbName(name)) {
          names.add(name);
        }
      }
    } catch {
      // The known names above cover browsers without indexedDB.databases().
    }
  }

  return Array.from(names).filter(Boolean);
};

const deleteIndexedDbDatabase = (indexedDBRef, name) => new Promise((resolve) => {
  if (!indexedDBRef || typeof indexedDBRef.deleteDatabase !== 'function' || !name) {
    resolve(false);
    return;
  }

  let request;
  try {
    request = indexedDBRef.deleteDatabase(name);
  } catch {
    resolve(false);
    return;
  }

  if (!request) {
    resolve(false);
    return;
  }

  request.onsuccess = () => resolve(true);
  request.onerror = () => resolve(false);
  request.onblocked = () => resolve(false);
});

export const clearSessionIndexedDb = async (indexedDBRef) => {
  const names = await getIndexedDbNames(indexedDBRef);
  const deletedNames = [];

  await Promise.all(names.map(async (name) => {
    const deleted = await deleteIndexedDbDatabase(indexedDBRef, name);
    if (deleted) deletedNames.push(name);
  }));

  return deletedNames;
};

export const resetBrowserSessionState = async ({
  logoutSession,
  firebaseAuth,
  firebaseUser = firebaseAuth?.currentUser || null,
  firebaseSignOut,
  nativeSignOut,
  clearRuntimeSession,
  windowRef = getWindowRef(),
  cacheStorage = windowRef?.caches || (typeof caches !== 'undefined' ? caches : null),
  serviceWorkerContainer = windowRef?.navigator?.serviceWorker || null,
  indexedDBRef = windowRef?.indexedDB || null,
  redirect = true,
  redirectTo = '/login',
  redirectFn,
} = {}) => {
  const result = {
    backendLogout: false,
    firebaseSignOut: false,
    nativeSignOut: false,
    clearedLocalStorageKeys: [],
    clearedSessionStorageKeys: [],
    clearedCacheKeys: [],
    unregisteredServiceWorkerCount: 0,
    deletedIndexedDbNames: [],
    redirectedTo: '',
  };

  if (typeof logoutSession === 'function') {
    try {
      await logoutSession({ firebaseUser });
      result.backendLogout = true;
    } catch (error) {
      result.backendLogoutError = error;
    }
  }

  if (firebaseAuth && typeof firebaseSignOut === 'function') {
    try {
      await firebaseSignOut(firebaseAuth);
      result.firebaseSignOut = true;
    } catch (error) {
      result.firebaseSignOutError = error;
    }
  }

  if (typeof nativeSignOut === 'function') {
    try {
      await nativeSignOut();
      result.nativeSignOut = true;
    } catch (error) {
      result.nativeSignOutError = error;
    }
  }

  if (typeof clearRuntimeSession === 'function') {
    try {
      clearRuntimeSession();
    } catch {
      // Browser storage cleanup below is still useful if React state cleanup fails.
    }
  }

  result.clearedLocalStorageKeys = clearStorageArea(windowRef?.localStorage || null);
  result.clearedSessionStorageKeys = clearStorageArea(windowRef?.sessionStorage || null);
  result.clearedCacheKeys = await clearCacheStorage(cacheStorage);
  const registrations = await unregisterServiceWorkers(serviceWorkerContainer);
  result.unregisteredServiceWorkerCount = registrations.length;
  result.deletedIndexedDbNames = await clearSessionIndexedDb(indexedDBRef);

  if (redirect) {
    const navigate = redirectFn
      || (windowRef?.location && typeof windowRef.location.assign === 'function'
        ? windowRef.location.assign.bind(windowRef.location)
        : null);

    if (navigate) {
      navigate(redirectTo);
      result.redirectedTo = redirectTo;
    }
  }

  return result;
};
