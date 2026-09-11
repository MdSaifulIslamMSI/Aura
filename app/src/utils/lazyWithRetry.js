import { lazy } from 'react';

const RETRY_PREFIX = 'aura-lazy-retry';
const DEFAULT_TIMEOUT_MS = 10000;
const RELOAD_PARAM = '__route-reload';

const isChunkLoadFailure = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('failed to fetch dynamically imported module')
    || message.includes('importing a module script failed')
    || message.includes('loading chunk')
    || message.includes('chunkloaderror')
    || message.includes('lazy route import timed out')
  );
};

const buildRetryKey = (key) => {
  if (typeof window === 'undefined') return `${RETRY_PREFIX}:${key}`;
  // Strip the reload marker from the key: forceRouteReload appends it before
  // reloading, and keying on it would hand every reload a fresh budget and
  // turn the single auto-retry into an infinite skeleton/reload loop.
  const url = new URL(window.location.href);
  url.searchParams.delete(RELOAD_PARAM);
  return `${RETRY_PREFIX}:${key}:${url.pathname}${url.search}`;
};

const forceRouteReload = (retryKey) => {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    return false;
  }

  if (sessionStorage.getItem(retryKey)) {
    sessionStorage.removeItem(retryKey);
    return false;
  }

  sessionStorage.setItem(retryKey, '1');
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set(RELOAD_PARAM, Date.now().toString());
  window.location.replace(nextUrl.toString());
  return true;
};

const withTimeout = (factory, timeoutMs, key) => Promise.race([
  factory(),
  new Promise((_, reject) => {
    window.setTimeout(() => {
      reject(new Error(`Lazy route import timed out: ${key}`));
    }, timeoutMs);
  }),
]);

export const loadWithRetry = async (factory, key, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const retryKey = buildRetryKey(key);

  try {
    const module = await withTimeout(factory, timeoutMs, key);
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(retryKey);
    }
    return module;
  } catch (error) {
    if (isChunkLoadFailure(error) && forceRouteReload(retryKey)) {
      return new Promise(() => {});
    }
    throw error;
  }
};

export const lazyWithRetry = (factory, key, timeoutMs = DEFAULT_TIMEOUT_MS) => lazy(() => loadWithRetry(factory, key, timeoutMs));

export default lazyWithRetry;
