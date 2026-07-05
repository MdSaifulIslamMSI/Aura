import path from 'node:path';
import process from 'node:process';
import {
  normalize,
  normalizeUrl,
  readJsonIfExists,
  repoRoot,
} from '../lib/release-guard-utils.mjs';

export const stateFile = path.join(repoRoot, '.staging', 'state.json');

export const readStagingState = () => readJsonIfExists(stateFile) || {};

const setEnv = (name, value, { preferState }) => {
  const normalized = normalize(value);
  if (!normalized) return;
  if (preferState || !normalize(process.env[name])) {
    process.env[name] = normalized;
  }
};

export const applyStagingStateEnv = ({ preferState = true } = {}) => {
  if (process.env.NODE_ENV === 'test' && process.env.AURA_ALLOW_STAGING_STATE_IN_TEST !== 'true') {
    return { applied: false, state: {}, skipped: 'test-env' };
  }

  const state = readStagingState();
  const baseUrl = normalizeUrl(state.staging_base_url || state.staging_api_base_url);
  const apiUrl = normalizeUrl(state.staging_api_base_url || state.staging_base_url);
  const healthUrl = normalizeUrl(state.staging_health_url || (apiUrl ? `${apiUrl}/health` : ''));
  const frontendUrl = normalizeUrl(state.staging_frontend_url || baseUrl);

  if (!baseUrl && !apiUrl && !healthUrl) {
    return { applied: false, state };
  }

  setEnv('STAGING_BASE_URL', baseUrl, { preferState });
  setEnv('SMOKE_BASE_URL', baseUrl, { preferState });
  setEnv('STAGING_API_BASE_URL', apiUrl, { preferState });
  setEnv('STAGING_HEALTH_URL', healthUrl, { preferState });
  setEnv('STAGING_FRONTEND_URL', frontendUrl, { preferState });
  setEnv('STAGING_SSM_PREFIX', state.ssm_prefix || '/aura/staging', { preferState });

  if (!normalize(process.env.SMOKE_TARGET_ENV)) process.env.SMOKE_TARGET_ENV = 'staging';
  if (!normalize(process.env.SMOKE_REQUIRE_BACKEND_STAGING)) process.env.SMOKE_REQUIRE_BACKEND_STAGING = 'true';
  if (!normalize(process.env.SMOKE_FORBID_PRODUCTION_ORIGINS)) process.env.SMOKE_FORBID_PRODUCTION_ORIGINS = 'true';
  if (!normalize(process.env.PROD_SSM_PREFIX)) process.env.PROD_SSM_PREFIX = '/aura/prod';

  return { applied: true, state };
};
