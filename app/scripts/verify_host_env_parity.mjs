#!/usr/bin/env node
// Verifies that the VITE_* build-env contract in deploy-netlify.yml matches
// what is actually configured on each storefront host BEFORE a build is
// produced. Byte-identity across Netlify/Vercel/AWS/Render/Railway depends on
// every host inlining the same import.meta.env object, so:
//   - every expected non-empty VITE_ var must exist on the host,
//   - every expected-empty VITE_ var must be empty on hosts that allow it and
//     absent on Render (its env-vars API rejects empty values; Railway allows
//     empty values via `railway variable set KEY=`, so it follows the
//     Netlify/Vercel rule, not the Render rule),
//   - any host-side VITE_ var the build contract does not define is drift.
//
// Usage (all hosts optional — a host is checked only when its creds exist):
//   node app/scripts/verify_host_env_parity.mjs --expected-file <manifest.json>
//
// Expected manifest: {"vars":[{"name":"VITE_X","empty":false}, ...]}
// Exit 0 = parity holds; exit 1 = contract violations (listed).
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Pure parity checker (fixture-tested). Each host arg: {vars: [{key, value}]|null}
 * where value null means the API hides values (presence-only evidence).
 */
export function checkParity(expectedVars, hosts) {
  const violations = [];
  const expected = new Map(expectedVars.map((v) => [v.name, v]));
  const expectedNonEmpty = expectedVars.filter((v) => !v.empty).map((v) => v.name);
  const expectedEmpty = expectedVars.filter((v) => v.empty).map((v) => v.name);

  for (const [host, state] of Object.entries(hosts)) {
    if (!state || !state.vars) continue; // host not configured for this check
    const actual = new Map(state.vars.map((v) => [v.key, v.value === undefined ? null : v.value]));
    const actualNames = new Set(actual.keys());

    for (const name of expectedNonEmpty) {
      if (!actualNames.has(name)) {
        violations.push(`${host}: expected non-empty VITE_ var ${name} is not configured on the host`);
      }
    }

    for (const name of expectedEmpty) {
      if (!actualNames.has(name)) continue;
      const value = actual.get(name);
      if (host === 'render') {
        violations.push(`${host}: expected-empty VITE_ var ${name} exists on Render (Render rejects empty env values; remove it host-side)`);
      } else if (value !== null && value !== '') {
        violations.push(`${host}: expected-empty VITE_ var ${name} has a host-side value but the CI build runs without it (bundle divergence)`);
      }
    }

    for (const name of actualNames) {
      if (!expected.has(name)) {
        violations.push(`${host}: host-side VITE_ var ${name} is not part of the CI build contract (remove it or add it to the deploy workflow build env)`);
        continue;
      }
      const value = actual.get(name);
      if (value === null) continue; // masked by the provider; presence already checked
      if (!expected.get(name).empty && value === '') {
        violations.push(`${host}: VITE_ var ${name} is empty on the host but non-empty in the CI build contract`);
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function parseExpectedFile(path) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  const vars = Array.isArray(raw) ? raw : raw.vars;
  if (!Array.isArray(vars)) {
    throw new Error('expected manifest must be {"vars":[{"name","empty"}]} or an array');
  }
  for (const entry of vars) {
    if (!entry || typeof entry.name !== 'string' || !entry.name.startsWith('VITE_')) {
      throw new Error(`bad manifest entry: ${JSON.stringify(entry)}`);
    }
    entry.empty = Boolean(entry.empty);
  }
  return vars;
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`${url} -> HTTP ${response.status}`);
  }
  return response.json();
}

async function collectNetlifyVars(token, siteId) {
  const payload = await fetchJson(`https://api.netlify.com/api/v1/sites/${siteId}/env_vars`, {
    Authorization: `Bearer ${token}`,
  });
  const vars = (Array.isArray(payload) ? payload : payload.env_vars || [])
    .filter((entry) => entry.key && entry.key.startsWith('VITE_'))
    .map((entry) => {
      const contextValues = entry.values || {};
      const value = Object.prototype.hasOwnProperty.call(contextValues, 'production')
        ? contextValues.production
        : contextValues.all;
      return { key: entry.key, value: value === undefined ? null : value };
    });
  return { vars };
}

async function collectVercelVars(token, teamId, projectId) {
  const query = new URLSearchParams({ environment: 'production' });
  if (teamId) query.set('teamId', teamId);
  const payload = await fetchJson(
    `https://api.vercel.com/v9/projects/${projectId}/env?${query.toString()}`,
    { Authorization: `Bearer ${token}` }
  );
  const vars = (payload.envs || [])
    .filter((entry) => entry.key && entry.key.startsWith('VITE_'))
    .map((entry) => ({ key: entry.key, value: entry.value === undefined ? null : entry.value }));
  return { vars };
}

async function collectRenderVars(token, serviceId) {
  const payload = await fetchJson(`https://api.render.com/v1/services/${serviceId}/env-vars`, {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  });
  const vars = (Array.isArray(payload) ? payload : [])
    .map((entry) => entry.envVar || entry)
    .filter((entry) => entry.key && entry.key.startsWith('VITE_'))
    .map((entry) => ({ key: entry.key, value: entry.value === undefined ? null : entry.value }));
  return { vars };
}

// Railway public API is GraphQL-only: POST https://backboard.railway.com/graphql/v2
// with `Authorization: Bearer <RAILWAY_API_TOKEN>`. Variables query shape:
//   query variables($projectId: String!, $environmentId: String!, $serviceId: String) {
//     variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
//   }
// Values arrive masked for secrets, so masked entries carry value null
// (presence-only evidence, same as the Vercel collector below).
async function collectRailwayVars(apiToken, projectId, environmentId, serviceId) {
  const body = {
    query: 'query variables($projectId: String!, $environmentId: String!, $serviceId: String) { variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) }',
    variables: { projectId, environmentId, serviceId },
  };
  // Project tokens authenticate with the Project-Access-Token header
  // (Bearer is rejected); account/user tokens use Bearer. Try the project
  // header first and fall back to Bearer only on 401/403.
  const headerAttempts = [
    { 'Project-Access-Token': apiToken, 'Content-Type': 'application/json' },
    { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
  ];
  let payload;
  let lastAuthError;
  for (const headers of headerAttempts) {
    const response = await fetch('https://backboard.railway.com/graphql/v2', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (response.status === 401 || response.status === 403) {
      lastAuthError = new Error(`https://backboard.railway.com/graphql/v2 -> HTTP ${response.status}`);
      continue;
    }
    if (!response.ok) {
      throw new Error(`https://backboard.railway.com/graphql/v2 -> HTTP ${response.status}`);
    }
    payload = await response.json();
    break;
  }
  if (!payload) {
    throw lastAuthError || new Error('https://backboard.railway.com/graphql/v2 -> no response');
  }
  if (payload.errors?.length) {
    throw new Error(`railway variables query failed: ${payload.errors[0]?.message || 'unknown error'}`);
  }
  const variables = payload?.data?.variables || {};
  const vars = Object.entries(variables)
    .filter(([key]) => key.startsWith('VITE_'))
    .map(([key, value]) => ({ key, value: value === undefined ? null : value }));
  return { vars };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? undefined : args[index + 1];
  };
  const expectedFile = flag('expected-file');
  if (!expectedFile) {
    console.error('usage: verify_host_env_parity.mjs --expected-file <manifest.json>');
    process.exit(1);
  }
  const expectedVars = parseExpectedFile(expectedFile);

  const hosts = {};
  const errors = [];
  if (process.env.NETLIFY_AUTH_TOKEN && process.env.NETLIFY_SITE_ID) {
    try {
      hosts.netlify = await collectNetlifyVars(process.env.NETLIFY_AUTH_TOKEN, process.env.NETLIFY_SITE_ID);
    } catch (error) {
      errors.push(`netlify collection failed: ${error.message}`);
    }
  }
  if (process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID) {
    try {
      hosts.vercel = await collectVercelVars(
        process.env.VERCEL_TOKEN.replace(/^\s+|\s+$/g, ''),
        process.env.VERCEL_ORG_ID,
        process.env.VERCEL_PROJECT_ID
      );
    } catch (error) {
      errors.push(`vercel collection failed: ${error.message}`);
    }
  }
  if (process.env.RENDER_API_KEY && process.env.RENDER_SERVICE_ID) {
    try {
      hosts.render = await collectRenderVars(process.env.RENDER_API_KEY, process.env.RENDER_SERVICE_ID);
    } catch (error) {
      errors.push(`render collection failed: ${error.message}`);
    }
  }
  if (process.env.RAILWAY_API_TOKEN && process.env.RAILWAY_PROJECT_ID && process.env.RAILWAY_ENVIRONMENT_ID && process.env.RAILWAY_SERVICE_ID) {
    try {
      hosts.railway = await collectRailwayVars(
        process.env.RAILWAY_API_TOKEN,
        process.env.RAILWAY_PROJECT_ID,
        process.env.RAILWAY_ENVIRONMENT_ID,
        process.env.RAILWAY_SERVICE_ID
      );
    } catch (error) {
      errors.push(`railway collection failed: ${error.message}`);
    }
  }

  const verdict = checkParity(expectedVars, hosts);
  const summary = {
    expectedVarCount: expectedVars.length,
    hostsChecked: Object.keys(hosts),
    collectionErrors: errors,
    ...verdict,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (errors.length > 0 || !verdict.ok) {
    process.exit(1);
  }
  console.log(`[verify-host-env-parity] ${summary.hostsChecked.join(', ') || 'no hosts configured'} match the CI build contract.`);
}

// CLI entry only when executed directly (fixture tests import the pure checker).
// pathToFileURL resolves relative invocations (node ./app/scripts/...) to the
// same absolute file URL as import.meta.url on every platform.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
