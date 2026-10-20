/* global __AURA_RELEASE__ */

const DEFAULT_RELEASE_INFO = Object.freeze({
  id: 'runtime-unknown',
  commitSha: 'unknown',
  shortCommitSha: 'unknown',
  deployTarget: 'unknown',
  channel: import.meta.env.DEV ? 'development' : 'production',
  source: import.meta.env.DEV ? 'vite-dev-server' : 'runtime',
  builtAt: '',
});

const sanitizeValue = (value = '', fallback = 'unknown') => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
};

const resolveOrigin = (origin = '') => {
  const candidateOrigin = sanitizeValue(
    origin || (typeof window !== 'undefined' ? window.location.origin : ''),
    ''
  );

  if (!candidateOrigin) {
    return '';
  }

  try {
    return new URL(candidateOrigin).origin;
  } catch {
    return candidateOrigin;
  }
};

const rawReleaseInfo = typeof __AURA_RELEASE__ === 'object' && __AURA_RELEASE__
  ? __AURA_RELEASE__
  : DEFAULT_RELEASE_INFO;

export const releaseInfo = Object.freeze({
  id: sanitizeValue(rawReleaseInfo.id, DEFAULT_RELEASE_INFO.id),
  commitSha: sanitizeValue(rawReleaseInfo.commitSha, DEFAULT_RELEASE_INFO.commitSha),
  shortCommitSha: sanitizeValue(rawReleaseInfo.shortCommitSha, DEFAULT_RELEASE_INFO.shortCommitSha),
  deployTarget: sanitizeValue(rawReleaseInfo.deployTarget, DEFAULT_RELEASE_INFO.deployTarget),
  channel: sanitizeValue(rawReleaseInfo.channel, DEFAULT_RELEASE_INFO.channel),
  source: sanitizeValue(rawReleaseInfo.source, DEFAULT_RELEASE_INFO.source),
  builtAt: sanitizeValue(rawReleaseInfo.builtAt, ''),
});

export const formatReleaseBuiltAt = (builtAt = releaseInfo.builtAt) => {
  if (!builtAt) {
    return 'build time unavailable';
  }

  const parsedDate = new Date(builtAt);
  if (Number.isNaN(parsedDate.getTime())) {
    return builtAt;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsedDate);
};

export const resolveRuntimeHost = (origin = '') => {
  const runtimeOrigin = resolveOrigin(origin);
  if (!runtimeOrigin) {
    return 'unknown';
  }

  const vercelOrigin = resolveOrigin(import.meta.env.VITE_VERCEL_FRONTEND_URL);
  if (vercelOrigin && runtimeOrigin === vercelOrigin) {
    return 'vercel';
  }

  const netlifyOrigin = resolveOrigin(import.meta.env.VITE_NETLIFY_FRONTEND_URL);
  if (netlifyOrigin && runtimeOrigin === netlifyOrigin) {
    return 'netlify';
  }

  try {
    const hostname = new URL(runtimeOrigin).hostname.toLowerCase();

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'local';
    }

    if (hostname.includes('vercel.app')) {
      return 'vercel';
    }

    if (hostname.includes('netlify.app')) {
      return 'netlify';
    }

    return hostname;
  } catch {
    return runtimeOrigin;
  }
};

const upsertMetaTag = (name, content) => {
  if (typeof document === 'undefined' || !name || !content) {
    return;
  }

  let metaTag = document.querySelector(`meta[name="${name}"]`);
  if (!metaTag) {
    metaTag = document.createElement('meta');
    metaTag.setAttribute('name', name);
    document.head.appendChild(metaTag);
  }

  metaTag.setAttribute('content', content);
};

export const publishReleaseInfo = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const runtimeOrigin = resolveOrigin(window.location.origin);
  const runtimeHost = resolveRuntimeHost(runtimeOrigin);
  const runtimeReleaseInfo = Object.freeze({
    ...releaseInfo,
    runtimeOrigin,
    runtimeHost,
  });

  window.__AURA_RELEASE__ = runtimeReleaseInfo;

  document.documentElement.dataset.auraReleaseId = releaseInfo.id;
  document.documentElement.dataset.auraReleaseCommit = releaseInfo.shortCommitSha;
  document.documentElement.dataset.auraDeployTarget = releaseInfo.deployTarget;
  document.documentElement.dataset.auraReleaseChannel = releaseInfo.channel;
  document.documentElement.dataset.auraRuntimeHost = runtimeHost;

  upsertMetaTag('aura-release-id', releaseInfo.id);
  upsertMetaTag('aura-release-commit', releaseInfo.shortCommitSha);
  upsertMetaTag('aura-release-target', releaseInfo.deployTarget);
  upsertMetaTag('aura-release-channel', releaseInfo.channel);
  upsertMetaTag('aura-release-built-at', releaseInfo.builtAt);
  upsertMetaTag('aura-runtime-host', runtimeHost);
};

export default releaseInfo;
