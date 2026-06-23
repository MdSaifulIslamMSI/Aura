import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const BACKEND_PROXY_PATHS = ['/api', '/health', '/uploads', '/socket.io'];
export const STAGING_SSM_PREFIX = '/aura/staging';
export const PRODUCTION_SSM_PREFIX = '/aura/prod';

export const KNOWN_PRODUCTION_HOSTS = [
  'dbtrhsolhec1s.cloudfront.net',
  'aurapilot.vercel.app',
  'aura-gateway.vercel.app',
  'aurapilot.netlify.app',
];

export const TRACKED_CONTRACT_FILES = [
  'package.json',
  'vercel.json',
  'netlify.toml',
  'docker-compose.yml',
  'docker-compose.split-runtime.yml',
  'docs/environment-contract.md',
  'docs/staging-bootstrap.md',
  'docs/staging-free-aws-bootstrap.md',
  'docs/staging-readiness-inventory.md',
  'docs/staging-runbook.md',
  'docs/staging-operations-upgrades.md',
  'config/environments/staging.example.json',
  'config/environments/staging.example.env',
  'scripts/smoke/assert-staging-contract.mjs',
  'scripts/smoke/assert-frontend-staging-target.mjs',
  'scripts/smoke/staging-route-smoke.mjs',
  'scripts/smoke-preflight.mjs',
  'scripts/validate-env-contract.mjs',
  'scripts/scan-prod-fallbacks.mjs',
  'server/scripts/assert_staging_smoke_safety.js',
  '.github/workflows/staging-smoke.yml',
  '.github/workflows/staging-frontend-smoke.yml',
  '.github/workflows/staging-aws-deploy.yml',
  '.github/workflows/staging-ops-watch.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/security-gates.yml',
  '.github/workflows/production-cicd.yml',
];

export const normalize = (value = '') => String(value === undefined || value === null ? '' : value).trim();
export const normalizeLower = (value = '') => normalize(value).toLowerCase();

export const isTruthy = (value = '') => ['1', 'true', 'yes', 'on'].includes(normalizeLower(value));

export const getUrlHost = (value = '') => {
  try {
    return new URL(normalize(value)).hostname.toLowerCase();
  } catch {
    return '';
  }
};

export const isLocalUrl = (value = '') => {
  const host = getUrlHost(value);
  return ['localhost', '127.0.0.1', '::1'].includes(host);
};

export const isKnownProductionHost = (value = '') => {
  const host = getUrlHost(value) || normalizeLower(value);
  if (!host) return false;
  return KNOWN_PRODUCTION_HOSTS.some((knownHost) => host === knownHost || host.endsWith(`.${knownHost}`));
};

export const looksProductionLike = (value = '') => {
  const normalized = normalize(value);
  if (!normalized) return false;
  return isKnownProductionHost(normalized)
    || /(^|[^a-z0-9])(prod|production|live)([^a-z0-9]|$)/i.test(normalized)
    || /\/aura\/prod(?:\/|$)/i.test(normalized)
    || /\b(sk|pk)_live_/i.test(normalized)
    || /\brzp_live_/i.test(normalized);
};

export const looksPreviewUrl = (value = '') => {
  const host = getUrlHost(value);
  return Boolean(host && host.endsWith('.vercel.app') && !isKnownProductionHost(host));
};

export const toDisplayUrl = (value = '') => {
  const normalized = normalize(value);
  if (!normalized) return '<unset>';
  try {
    const url = new URL(normalized);
    return `${url.protocol}//${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return '<set:non-url>';
  }
};

export const readTextIfExists = (relativePath, root = REPO_ROOT) => {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return '';
  return fs.readFileSync(absolutePath, 'utf8');
};

export const pathExists = (relativePath, root = REPO_ROOT) => fs.existsSync(path.join(root, relativePath));

const pathMatchesBackendProxy = (routePath = '') => {
  const normalizedPath = normalizeLower(routePath);
  return BACKEND_PROXY_PATHS.some((backendPath) => normalizedPath === backendPath
    || normalizedPath.startsWith(`${backendPath}/`)
    || normalizedPath.startsWith(`${backendPath}:`)
    || normalizedPath.startsWith(`${backendPath}/*`));
};

export const inspectVercelBackendRoutes = ({ root = REPO_ROOT, file = 'vercel.json' } = {}) => {
  const raw = readTextIfExists(file, root);
  if (!raw) return { file, routes: [], errors: [`${file} is missing`] };
  try {
    const parsed = JSON.parse(raw);
    const routes = (Array.isArray(parsed.rewrites) ? parsed.rewrites : [])
      .filter((route) => pathMatchesBackendProxy(route.source))
      .map((route) => ({
        source: normalize(route.source),
        destination: normalize(route.destination),
        productionDestination: isKnownProductionHost(route.destination),
      }));
    return { file, routes, errors: [] };
  } catch (error) {
    return { file, routes: [], errors: [`${file} is not valid JSON: ${error.message}`] };
  }
};

export const inspectNetlifyBackendRoutes = ({ root = REPO_ROOT, file = 'netlify.toml' } = {}) => {
  const raw = readTextIfExists(file, root);
  if (!raw) return { file, routes: [], errors: [`${file} is missing`] };

  const blocks = raw.split(/\n\s*\[\[redirects\]\]\s*\n/g).slice(1);
  const routes = blocks.map((block) => {
    const from = block.match(/^\s*from\s*=\s*"([^"]+)"/m)?.[1] || '';
    const to = block.match(/^\s*to\s*=\s*"([^"]+)"/m)?.[1] || '';
    return { source: from, destination: to, productionDestination: isKnownProductionHost(to) };
  }).filter((route) => pathMatchesBackendProxy(route.source));

  return { file, routes, errors: [] };
};

export const getTargetEnv = (env = process.env, fallback = 'local') => {
  const raw = normalizeLower(env.SMOKE_TARGET_ENV || env.CONTRACT_TARGET_ENV || env.VERCEL_ENV || env.APP_ENV || fallback);
  if (raw === 'preview') return 'preview';
  if (raw === 'stage') return 'staging';
  if (['local', 'staging', 'production'].includes(raw)) return raw;
  return raw || 'local';
};

export const buildContractSnapshot = ({ env = process.env, root = REPO_ROOT } = {}) => {
  const targetEnv = getTargetEnv(env);
  const smokeBaseUrl = normalize(env.SMOKE_BASE_URL || '');
  const stagingBaseUrl = normalize(env.STAGING_BASE_URL || '');
  const stagingApiBaseUrl = normalize(env.STAGING_API_BASE_URL || env.STAGING_BACKEND_BASE_URL || '');
  const stagingHealthUrlProvided = Boolean(normalize(env.STAGING_HEALTH_URL || ''));
  const stagingHealthUrl = normalize(env.STAGING_HEALTH_URL || (stagingApiBaseUrl ? `${stagingApiBaseUrl.replace(/\/+$/, '')}/health` : ''));
  const stagingSsmPrefix = normalize(env.STAGING_SSM_PREFIX || env.AWS_PARAMETER_STORE_PATH_PREFIX || '');
  const prodBaseUrl = normalize(env.PROD_BASE_URL || env.AWS_FRONTEND_PUBLIC_URL || env.NETLIFY_PRODUCTION_URL || '');
  const prodApiBaseUrl = normalize(env.PROD_API_BASE_URL || env.AURA_BACKEND_ORIGIN || env.AWS_BACKEND_BASE_URL || '');
  const prodSsmPrefix = normalize(env.PROD_SSM_PREFIX || '');
  const scannerReadyRequired = isTruthy(env.SMOKE_REQUIRE_SCANNER_READY);
  const vercelRoutes = inspectVercelBackendRoutes({ root });
  const netlifyRoutes = inspectNetlifyBackendRoutes({ root });

  return {
    targetEnv,
    smokeBaseUrl,
    stagingBaseUrl,
    stagingApiBaseUrl,
    stagingHealthUrl,
    stagingHealthUrlProvided,
    stagingSsmPrefix,
    prodBaseUrl,
    prodApiBaseUrl,
    prodSsmPrefix,
    scannerReadyRequired,
    allowProductionSmoke: isTruthy(env.ALLOW_PRODUCTION_SMOKE),
    vercelRoutes,
    netlifyRoutes,
    docsMentionStagingPrefix: TRACKED_CONTRACT_FILES.some((file) => readTextIfExists(file, root).includes(STAGING_SSM_PREFIX)),
    docsMentionProductionPrefix: TRACKED_CONTRACT_FILES.some((file) => readTextIfExists(file, root).includes(PRODUCTION_SSM_PREFIX)),
    stagingExampleExists: pathExists('config/environments/staging.example.json', root),
  };
};

export const validateContract = ({ env = process.env, root = REPO_ROOT, mode = 'validate' } = {}) => {
  const snapshot = buildContractSnapshot({ env, root });
  const failures = [];
  const warnings = [];
  const info = [];

  const productionValues = [
    snapshot.prodBaseUrl,
    snapshot.prodApiBaseUrl,
    ...KNOWN_PRODUCTION_HOSTS.map((host) => `https://${host}`),
  ].filter(Boolean);

  const equalsProductionValue = (value = '') => {
    const normalized = normalize(value).replace(/\/+$/, '');
    return productionValues.some((candidate) => normalize(candidate).replace(/\/+$/, '') === normalized)
      || isKnownProductionHost(normalized);
  };

  if (!snapshot.docsMentionStagingPrefix) {
    failures.push(`Tracked environment contract files must mention ${STAGING_SSM_PREFIX}.`);
  }
  if (!snapshot.docsMentionProductionPrefix) {
    failures.push(`Tracked environment contract files must mention ${PRODUCTION_SSM_PREFIX}.`);
  }
  if (!snapshot.stagingExampleExists) {
    failures.push('config/environments/staging.example.json is required.');
  }

  const vercelProdBackendRoutes = snapshot.vercelRoutes.routes.filter((route) => route.productionDestination);
  if (snapshot.vercelRoutes.errors.length > 0) {
    failures.push(...snapshot.vercelRoutes.errors);
  }

  const effectivePreviewCandidate = snapshot.smokeBaseUrl || snapshot.stagingBaseUrl;
  if (snapshot.targetEnv === 'preview' && vercelProdBackendRoutes.length > 0) {
    failures.push(`preview cannot use Vercel backend routes that proxy to production: ${
      vercelProdBackendRoutes.map((route) => `${route.source}->${toDisplayUrl(route.destination)}`).join(', ')
    }.`);
  }

  if (snapshot.targetEnv === 'staging') {
    const effectiveSmokeUrl = snapshot.smokeBaseUrl || snapshot.stagingBaseUrl;
    if (!snapshot.smokeBaseUrl) failures.push('SMOKE_BASE_URL is required when SMOKE_TARGET_ENV=staging.');
    if (!snapshot.stagingBaseUrl) failures.push('STAGING_BASE_URL is required when SMOKE_TARGET_ENV=staging.');
    if (!snapshot.stagingApiBaseUrl) failures.push('STAGING_API_BASE_URL is required when SMOKE_TARGET_ENV=staging.');
    if (!snapshot.stagingHealthUrlProvided) failures.push('STAGING_HEALTH_URL is required when SMOKE_TARGET_ENV=staging.');
    if (snapshot.stagingSsmPrefix !== STAGING_SSM_PREFIX) {
      failures.push(`STAGING_SSM_PREFIX must be ${STAGING_SSM_PREFIX} when SMOKE_TARGET_ENV=staging.`);
    }
    if (
      snapshot.smokeBaseUrl
      && snapshot.stagingBaseUrl
      && snapshot.smokeBaseUrl.replace(/\/+$/, '') !== snapshot.stagingBaseUrl.replace(/\/+$/, '')
    ) {
      failures.push('SMOKE_BASE_URL must equal STAGING_BASE_URL when SMOKE_TARGET_ENV=staging.');
    }
    if (effectiveSmokeUrl && equalsProductionValue(effectiveSmokeUrl)) {
      failures.push('SMOKE_BASE_URL/STAGING_BASE_URL must not point at a known production URL.');
    }
    if (snapshot.stagingApiBaseUrl && equalsProductionValue(snapshot.stagingApiBaseUrl)) {
      failures.push('STAGING_API_BASE_URL must not point at a known production URL.');
    }
    if (snapshot.stagingHealthUrl && equalsProductionValue(snapshot.stagingHealthUrl)) {
      failures.push('STAGING_HEALTH_URL must not point at a known production URL.');
    }
    if ((looksPreviewUrl(effectiveSmokeUrl) || looksPreviewUrl(effectivePreviewCandidate)) && vercelProdBackendRoutes.length > 0) {
      failures.push('Vercel Preview URL cannot be accepted as staging while backend routes proxy to production.');
    }
    if (looksProductionLike(snapshot.stagingSsmPrefix)) {
      failures.push('Staging smoke must not use a production-like SSM prefix.');
    }
  }

  if (snapshot.targetEnv === 'production') {
    if (!snapshot.allowProductionSmoke) {
      failures.push('Production smoke requires ALLOW_PRODUCTION_SMOKE=true.');
    }
    if (!snapshot.smokeBaseUrl && !snapshot.prodBaseUrl && !snapshot.prodApiBaseUrl) {
      failures.push('Production smoke requires an explicit production base URL.');
    }
    if (snapshot.stagingSsmPrefix === STAGING_SSM_PREFIX) {
      failures.push('Production smoke must not reuse STAGING_SSM_PREFIX.');
    }
  }

  if (snapshot.targetEnv === 'local') {
    if (snapshot.smokeBaseUrl && !isLocalUrl(snapshot.smokeBaseUrl)) {
      failures.push('Local smoke may only use localhost, 127.0.0.1, or ::1.');
    }
    if (!snapshot.smokeBaseUrl) {
      info.push('Local smoke base URL is unset; default local-only checks may use http://127.0.0.1:5000.');
    }
  }

  if (!['local', 'staging', 'preview', 'production'].includes(snapshot.targetEnv)) {
    failures.push(`Unsupported target environment: ${snapshot.targetEnv}.`);
  }

  if (snapshot.targetEnv !== 'staging' && !snapshot.stagingBaseUrl) {
    warnings.push('Live staging URL is not configured; staging smoke remains blocked until STAGING_BASE_URL and STAGING_API_BASE_URL exist.');
  }

  const safe = failures.length === 0;
  return {
    safe,
    mode,
    classification: safe ? 'safe' : 'blocked',
    currentStatus: snapshot.stagingBaseUrl && snapshot.stagingApiBaseUrl
      ? 'Live staging contract is configured for validation.'
      : 'Code is staging-safe, but live staging infrastructure is not present yet.',
    failures,
    warnings,
    info,
    snapshot,
  };
};

export const printContractReport = (result, { stream = process.stdout } = {}) => {
  const { snapshot } = result;
  stream.write(`environment-contract: ${result.classification}\n`);
  stream.write(`target env: ${snapshot.targetEnv}\n`);
  stream.write(`base URL: ${toDisplayUrl(snapshot.smokeBaseUrl || snapshot.stagingBaseUrl || snapshot.prodBaseUrl)}\n`);
  stream.write(`backend URL: ${toDisplayUrl(snapshot.stagingApiBaseUrl || snapshot.prodApiBaseUrl)}\n`);
  stream.write(`health URL: ${toDisplayUrl(snapshot.stagingHealthUrl)}\n`);
  stream.write(`SSM prefix: ${snapshot.stagingSsmPrefix || snapshot.prodSsmPrefix || '<unset>'}\n`);
  stream.write(`scanner readiness required: ${snapshot.scannerReadyRequired ? 'true' : 'false'}\n`);
  stream.write(`status: ${result.currentStatus}\n`);
  for (const failure of result.failures) stream.write(`FAIL: ${failure}\n`);
  for (const warning of result.warnings) stream.write(`WARN: ${warning}\n`);
  for (const item of result.info) stream.write(`INFO: ${item}\n`);
};
