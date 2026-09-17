// Single source of truth for the Railway VITE_* build contract.
// Railway (like Render) builds the storefront from source instead of receiving
// the shared CI artifact, so it must build with the exact env CI used or its
// bytes diverge from the other hosts. Keep LITERALS/PASSTHROUGH aligned with
// the Render parity injection in .github/workflows/deploy-netlify.yml — the
// ci:doctor "parity injection covers the CI VITE_ build contract" gate
// enforces coverage across both.
'use strict';

// Values CI derives (never host secrets). `VITE_RELEASE_*` falls back to the
// ref the caller wants stamped: the release SHA for deploys, the rollback
// commit for rollbacks.
const buildRailwayBuildEnv = (env = process.env) => {
  const releaseRef = env.VITE_RELEASE_SHA || env.ROLLBACK_REF || env.GITHUB_SHA || '';
  const backendOrigin = String(env.BACKEND_ORIGIN || '').replace(/\/+$/, '');
  const literals = {
    VITE_DEPLOY_TARGET: env.VITE_DEPLOY_TARGET || 'multi-host',
    VITE_API_URL: backendOrigin ? `${backendOrigin}/api` : (env.VITE_API_URL || ''),
    VITE_RELEASE_ID: env.VITE_RELEASE_ID || releaseRef,
    VITE_RELEASE_SHA: releaseRef,
    VITE_RELEASE_CHANNEL: env.VITE_RELEASE_CHANNEL || 'production',
    VITE_RELEASE_SOURCE: env.VITE_RELEASE_SOURCE || 'github-actions',
    VITE_RELEASE_TIME: env.VITE_RELEASE_TIME || env.BUILT_AT || '',
    VITE_SENTRY_RELEASE: releaseRef,
    VITE_DD_SITE: env.VITE_DD_SITE || 'us5.datadoghq.com',
    NODE_VERSION: String(env.NODE_VERSION || '24').split('.')[0],
  };
  const passthrough = [
    'VITE_SENTRY_DSN',
    'VITE_DD_APPLICATION_ID',
    'VITE_DD_CLIENT_TOKEN',
    'VITE_TURNSTILE_SITE_KEY',
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_MEASUREMENT_ID',
    'VITE_FIREBASE_CONFIG',
    'VITE_FIREBASE_DISABLE_SOCIAL_AUTH',
    'VITE_FIREBASE_ENABLE_MICROSOFT_AUTH',
    'VITE_FIREBASE_ENABLE_APPLE_AUTH',
    'VITE_DUO_LOGIN_ENABLED',
    'VITE_ADMIN_SECURITY_STATE_ENGINE_V2',
  ];
  const contract = { ...literals };
  for (const key of passthrough) {
    contract[key] = env[key] ?? '';
  }
  // The shared CI build drops empty VITE_* vars before building (the build
  // step's empty-drop loop), and `railway variable set --stdin` rejects empty
  // values outright. Dropping them here keeps a Railway rebuild byte-comparable
  // with the shared artifact: absent key on both sides, never defined-empty.
  for (const key of Object.keys(contract)) {
    if (contract[key] === '') delete contract[key];
  }
  return contract;
};

module.exports = { buildRailwayBuildEnv };
