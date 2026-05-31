#!/usr/bin/env node
import process from 'node:process';
import {
  KNOWN_PRODUCTION_HOSTS,
  STAGING_SSM_PREFIX,
  getUrlHost,
  isKnownProductionHost,
  looksProductionLike,
  normalize,
  toDisplayUrl,
} from '../env-contract-lib.mjs';

const failures = [];
const notes = [];

const normalizeUrl = (value) => normalize(value).replace(/\/+$/, '');
const appendApiPath = (base) => `${normalizeUrl(base)}/api`;

const stagingFrontendUrl = normalizeUrl(process.env.STAGING_FRONTEND_URL || '');
const stagingApiBaseUrl = normalizeUrl(process.env.STAGING_API_BASE_URL || '');
const stagingHealthUrl = normalizeUrl(process.env.STAGING_HEALTH_URL || `${stagingApiBaseUrl}/health`);
const prodBaseUrl = normalizeUrl(process.env.PROD_BASE_URL || '');
const prodApiBaseUrl = normalizeUrl(process.env.PROD_API_BASE_URL || '');
const vercelAutomationBypassSecret = normalize(process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '');

const fail = (message) => failures.push(message);

const productionSignals = () => [
  prodBaseUrl,
  prodApiBaseUrl,
  ...KNOWN_PRODUCTION_HOSTS.map((host) => `https://${host}`),
].filter(Boolean);

const containsProductionSignal = (value = '') => {
  const text = normalize(value).toLowerCase();
  if (!text) return false;
  return productionSignals().some((signal) => signal && text.includes(normalize(signal).toLowerCase()))
    || KNOWN_PRODUCTION_HOSTS.some((host) => text.includes(host))
    || text.includes('/aura/prod');
};

const assertNotProduction = (label, value) => {
  if (!value) {
    fail(`${label} is required.`);
    return;
  }
  if (prodBaseUrl && normalizeUrl(value) === prodBaseUrl) fail(`${label} must not equal PROD_BASE_URL.`);
  if (prodApiBaseUrl && normalizeUrl(value) === prodApiBaseUrl) fail(`${label} must not equal PROD_API_BASE_URL.`);
  if (isKnownProductionHost(value) || looksProductionLike(value) || containsProductionSignal(value)) {
    fail(`${label} points to a production-like origin: ${toDisplayUrl(value)}.`);
  }
};

const fetchText = async (label, url, options = {}) => {
  assertNotProduction(label, url);
  const requestUrl = new URL(url);
  const frontendUrl = stagingFrontendUrl ? new URL(stagingFrontendUrl) : null;
  const protectionHeaders = vercelAutomationBypassSecret && frontendUrl && requestUrl.host === frontendUrl.host
    ? { 'x-vercel-protection-bypass': vercelAutomationBypassSecret }
    : {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'user-agent': 'aura-frontend-staging-smoke/1.0',
        ...protectionHeaders,
        ...(options.headers || {}),
      },
      ...options,
    });
    const location = response.headers.get('location') || '';
    const csp = response.headers.get('content-security-policy') || '';
    if (location && containsProductionSignal(location)) fail(`${label} redirects to a production origin.`);
    if (csp && containsProductionSignal(csp)) fail(`${label} CSP contains a production backend origin.`);
    const text = await response.text().catch(() => '');
    if (containsProductionSignal(text)) fail(`${label} body contains a production backend signal.`);
    notes.push(`${label}: ${response.status}`);
    return { response, text };
  } catch (error) {
    fail(`${label} request failed: ${error?.message || error}`);
    return { response: null, text: '' };
  } finally {
    clearTimeout(timeout);
  }
};

const parseAssetUrls = (html = '', baseUrl = '') => {
  const urls = new Set();
  for (const match of html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)=["']([^"']+)["']/gi)) {
    const raw = match[1];
    if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) continue;
    try {
      urls.add(new URL(raw, `${normalizeUrl(baseUrl)}/`).toString());
    } catch {
      // Ignore malformed asset refs; the browser smoke will catch broken deploys elsewhere.
    }
  }
  return Array.from(urls).filter((url) => /\.(?:js|mjs|css)(?:\?|$)/i.test(url)).slice(0, 20);
};

const assertHealthJson = async (label, response, text) => {
  if (!response) return;
  if (!response.ok) {
    fail(`${label} returned ${response.status}; expected a reachable staging health response.`);
    return;
  }
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    fail(`${label} did not return JSON.`);
    return;
  }
  if (json.env !== 'staging') fail(`${label} env must be staging.`);
  if (json.ssmPrefix !== STAGING_SSM_PREFIX) fail(`${label} ssmPrefix must be ${STAGING_SSM_PREFIX}.`);
  for (const field of ['database', 'cache', 'storage']) {
    const value = normalize(json[field]).toLowerCase();
    if (value !== 'staging') fail(`${label} ${field} must be staging; got ${value || '<unset>'}.`);
  }
  if (json.scanner !== 'ready') fail(`${label} scanner must be ready; got ${json.scanner || '<unset>'}.`);
};

assertNotProduction('STAGING_FRONTEND_URL', stagingFrontendUrl);
assertNotProduction('STAGING_API_BASE_URL', stagingApiBaseUrl);
const sameOriginFrontendBackend = Boolean(stagingFrontendUrl && stagingApiBaseUrl
  && getUrlHost(stagingFrontendUrl) === getUrlHost(stagingApiBaseUrl));

if (failures.length === 0) {
  const { response: frontendResponse, text: html } = await fetchText('frontend html', stagingFrontendUrl);
  if (!frontendResponse || ![200, 301, 302, 307, 308].includes(frontendResponse.status)) {
    fail(`frontend html returned ${frontendResponse?.status || '<no response>'}; expected 2xx/3xx.`);
  }

  for (const assetUrl of parseAssetUrls(html, stagingFrontendUrl)) {
    await fetchText(`frontend asset ${assetUrl}`, assetUrl);
  }

  const frontendHealth = await fetchText('frontend /health proxy', `${stagingFrontendUrl}/health`);
  await assertHealthJson('frontend /health proxy', frontendHealth.response, frontendHealth.text);

  const frontendApiHealth = await fetchText('frontend /api/health proxy', `${stagingFrontendUrl}/api/health`);
  if (frontendApiHealth.response && ![200, 204, 401, 403, 404].includes(frontendApiHealth.response.status)) {
    fail(`frontend /api/health proxy returned unexpected ${frontendApiHealth.response.status}.`);
  }

  const directHealth = await fetchText('direct staging health', stagingHealthUrl, sameOriginFrontendBackend
    ? {}
    : { headers: { origin: stagingFrontendUrl } });
  await assertHealthJson('direct staging health', directHealth.response, directHealth.text);
  const allowOrigin = directHealth.response?.headers.get('access-control-allow-origin') || '';
  if (!sameOriginFrontendBackend && directHealth.response && allowOrigin !== stagingFrontendUrl && allowOrigin !== '*') {
    fail(`direct staging health CORS did not allow frontend origin; got "${allowOrigin || '<missing>'}".`);
  }

  if (sameOriginFrontendBackend) {
    notes.push('same-origin staging frontend/backend: CORS preflight is not required for browser API calls');
  }

  if (allowOrigin === '*') {
    fail('direct staging health CORS must not use wildcard origin.');
  }

  await fetchText('frontend /uploads proxy', `${stagingFrontendUrl}/uploads/smoke-nonexistent.txt`);
  await fetchText('frontend /socket.io proxy', `${stagingFrontendUrl}/socket.io/?EIO=4&transport=polling`);
  assertNotProduction('VITE API target', appendApiPath(stagingApiBaseUrl));
}

if (failures.length > 0) {
  console.error('FAIL: frontend staging target is not safe');
  for (const note of notes) console.error(`- ${note}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('PASS: frontend staging target uses isolated AWS staging backend');
for (const note of notes) console.log(note);
