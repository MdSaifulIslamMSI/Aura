import { lazy } from 'react';

const RETRY_PREFIX = 'aura-lazy-retry';
const DEFAULT_TIMEOUT_MS = 10000;

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
  return `${RETRY_PREFIX}:${key}:${window.location.pathname}${window.location.search}`;
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
  nextUrl.searchParams.set('__route-reload', Date.now().toString());
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

export const lazyWithRetry = (factory, key, timeoutMs = DEFAULT_TIMEOUT_MS) => lazy(async () => {
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
});

export default lazyWithRetry;
