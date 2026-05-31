#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildFrontendSecurityHeaders,
  buildHostedBackendRewrites,
} from '../../app/config/vercelRoutingContract.mjs';
import {
  KNOWN_PRODUCTION_HOSTS,
  REPO_ROOT,
  getUrlHost,
  isKnownProductionHost,
  looksProductionLike,
  normalize,
} from '../env-contract-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resultPath = path.join(REPO_ROOT, '.staging', 'vercel-staging-result.json');
const protectionBypassPath = path.join(REPO_ROOT, '.staging', 'vercel-protection-bypass-response.json');
const blockerReportPath = path.join(REPO_ROOT, 'docs', 'staging-vercel-blocker-report.md');
const ghBin = process.platform === 'win32' ? 'gh.exe' : 'gh';

const warnings = [];
const failures = [];
let authMode = 'token';

const clean = (value = '') => String(value || '').trim();
const trimTrailingSlash = (value = '') => clean(value).replace(/\/+$/, '');
const requireEnv = (name) => {
  const value = clean(process.env[name]);
  if (!value) failures.push(`${name} is required.`);
  return value;
};

const env = {
  vercelToken: clean(process.env.VERCEL_TOKEN),
  projectId: requireEnv('VERCEL_PROJECT_ID'),
  orgId: requireEnv('VERCEL_ORG_ID'),
  stagingApiBaseUrl: trimTrailingSlash(requireEnv('STAGING_API_BASE_URL')),
  stagingHealthUrl: trimTrailingSlash(requireEnv('STAGING_HEALTH_URL')),
  prodBaseUrl: trimTrailingSlash(process.env.PROD_BASE_URL),
  prodApiBaseUrl: trimTrailingSlash(process.env.PROD_API_BASE_URL),
  stagingDomain: trimTrailingSlash(process.env.STAGING_DOMAIN),
  githubRepo: clean(process.env.GH_REPO || (process.env.GITHUB_OWNER && process.env.GITHUB_REPO
    ? `${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}`
    : '')),
};

const ensureStateDir = () => fs.mkdirSync(path.dirname(resultPath), { recursive: true });

const writeJson = (targetPath, value) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`);
};

const writeBlocker = (summary, details = []) => {
  const body = [
    '# Vercel Staging Blocker Report',
    '',
    'Final status: Code/docs/checks were added fail-closed, but Vercel frontend staging automation could not complete.',
    '',
    `Summary: ${summary}`,
    '',
    'Details:',
    ...details.map((detail) => `- ${detail}`),
    '',
    'Required fix:',
    '- Keep `npm run staging:deploy` on the Docker-hosted AWS staging frontend path while Vercel staging is blocked.',
    '- Provide a Vercel token or local CLI authentication that can inspect the project and write the required staging or branch-scoped Preview variables before creating Preview deployments.',
    '- Re-run `npm run staging:vercel:autopilot` after credentials are corrected.',
  ].join('\n');
  fs.writeFileSync(blockerReportPath, `${body}\n`);
};

const sanitize = (value = '') => {
  let text = String(value || '');
  if (env.vercelToken) text = text.replaceAll(env.vercelToken, '***');
  return text;
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd || REPO_ROOT,
    input: options.input,
    encoding: 'utf8',
    env: {
      ...process.env,
      VERCEL_ORG_ID: env.orgId,
      VERCEL_PROJECT_ID: env.projectId,
      ...(options.env || {}),
    },
    stdio: options.stdio || ['pipe', 'pipe', 'pipe'],
    shell: false,
  });
  return {
    status: result.status ?? 1,
    stdout: sanitize(result.stdout || ''),
    stderr: sanitize(result.stderr || result.error?.message || ''),
  };
};

const runNpx = (args, options = {}) => {
  if (process.platform !== 'win32') return run('npx', args, options);
  const npxCliPath = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  if (!fs.existsSync(npxCliPath)) {
    return {
      status: 1,
      stdout: '',
      stderr: `Unable to locate the trusted npm CLI entrypoint at ${npxCliPath}.`,
    };
  }
  return run(process.execPath, [npxCliPath, ...args], options);
};

const cliAuthArgs = () => [
  '--scope',
  env.orgId,
  ...(authMode === 'token' && env.vercelToken ? ['--token', env.vercelToken] : []),
];

const assertSafeUrl = (name, value) => {
  if (!value) {
    failures.push(`${name} is required.`);
    return;
  }
  if (!/^https?:\/\//i.test(value)) failures.push(`${name} must be an absolute http(s) URL.`);
  if (env.prodBaseUrl && trimTrailingSlash(value) === env.prodBaseUrl) failures.push(`${name} must not equal PROD_BASE_URL.`);
  if (env.prodApiBaseUrl && trimTrailingSlash(value) === env.prodApiBaseUrl) failures.push(`${name} must not equal PROD_API_BASE_URL.`);
  if (isKnownProductionHost(value) || looksProductionLike(value)) failures.push(`${name} is production-like: ${value}.`);
  const host = getUrlHost(value);
  if (KNOWN_PRODUCTION_HOSTS.some((prodHost) => host === prodHost || host.endsWith(`.${prodHost}`))) {
    failures.push(`${name} contains known production host ${host}.`);
  }
};

assertSafeUrl('STAGING_API_BASE_URL', env.stagingApiBaseUrl);
assertSafeUrl('STAGING_HEALTH_URL', env.stagingHealthUrl);
if (failures.length > 0) {
  writeBlocker('Required staging/Vercel environment variables are missing or unsafe.', failures);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const directApi = async (endpoint, options = {}) => {
  if (!env.vercelToken) throw new Error('VERCEL_TOKEN is not set.');
  const separator = endpoint.includes('?') ? '&' : '?';
  const response = await fetch(`https://api.vercel.com${endpoint}${separator}teamId=${encodeURIComponent(env.orgId)}`, {
    method: options.method || 'GET',
    headers: {
      authorization: `Bearer ${env.vercelToken}`,
      'content-type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(json?.error?.message || json?.message || `Vercel API ${response.status}`);
    error.status = response.status;
    error.body = json;
    throw error;
  }
  return json;
};

const cliApi = (endpoint, { method = 'GET', body } = {}) => {
  const inputPath = body ? path.join(os.tmpdir(), `aura-vercel-api-${Date.now()}.json`) : '';
  if (body) fs.writeFileSync(inputPath, JSON.stringify(body));
  const args = ['vercel', 'api', endpoint, '-X', method, '--raw', ...cliAuthArgs()];
  if (body) args.push('--input', inputPath);
  const result = runNpx(args);
  if (inputPath) fs.rmSync(inputPath, { force: true });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `vercel api ${endpoint} failed`);
  }
  return result.stdout ? JSON.parse(result.stdout) : {};
};

const api = async (endpoint, options = {}) => {
  if (authMode === 'token') return directApi(endpoint, options);
  return cliApi(endpoint, options);
};

const inspectProject = async () => {
  try {
    const project = await directApi(`/v9/projects/${env.projectId}`);
    authMode = 'token';
    return project;
  } catch (error) {
    if (![401, 403].includes(error.status)) throw error;
    warnings.push(`VERCEL_TOKEN cannot inspect project (${error.status}); trying existing non-interactive local Vercel CLI auth.`);
    authMode = 'local-cli';
    return cliApi(`/v9/projects/${env.projectId}`);
  }
};

const tryCreateCustomEnvironment = async (project) => {
  if (String(project?.plan || '').toLowerCase() === 'hobby') {
    warnings.push('Custom environments are unavailable on the detected Hobby plan; using Preview branch fallback.');
    return { ok: false, reason: 'plan_hobby' };
  }
  try {
    const created = await api(`/v9/projects/${env.projectId}/custom-environments`, {
      method: 'POST',
      body: {
        slug: 'staging',
        description: 'Aura isolated AWS staging frontend',
      },
    });
    return { ok: true, environment: created };
  } catch (error) {
    const status = error.status || 0;
    const message = error.body?.error?.code || error.body?.error?.message || error.message || 'custom environment failed';
    if ([400, 402, 403, 404, 409].includes(status)
      || /already|limit|forbidden|unsupported|unavailable|cannot create|custom environments|more than/i.test(message)) {
      warnings.push(`Custom environment staging unavailable (${status || 'unknown'} ${message}); using Preview branch fallback.`);
      return { ok: false, reason: message };
    }
    throw error;
  }
};

const setVercelEnv = (key, value, environment, branch) => {
  const removeArgs = ['vercel', 'env', 'rm', key, environment, ...(branch ? [branch] : []), '--yes', ...cliAuthArgs()];
  runNpx(removeArgs);
  const addArgs = ['vercel', 'env', 'add', key, environment, ...(branch ? [branch] : []), '--yes', ...cliAuthArgs()];
  const result = runNpx(addArgs, { input: value });
  if (result.status !== 0) {
    warnings.push(`Could not set Vercel env ${key} for ${environment}${branch ? `/${branch}` : ''}: ${result.stderr || result.stdout}`);
    return false;
  }
  return true;
};

const renderStagingVercelConfig = (targetRoot) => {
  const config = {
    buildCommand: 'npm run build --prefix app',
    outputDirectory: 'app/dist',
    rewrites: buildHostedBackendRewrites(env.stagingApiBaseUrl),
    headers: buildFrontendSecurityHeaders(env.stagingApiBaseUrl),
  };
  for (const relativePath of ['vercel.json', 'app/vercel.json']) {
    const target = path.join(targetRoot, relativePath);
    const current = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
    writeJson(target, {
      ...current,
      ...config,
      ...(relativePath === 'app/vercel.json' ? { buildCommand: undefined, outputDirectory: undefined } : {}),
    });
  }
};

const copyForDeploy = () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-vercel-deploy-'));
  const copyIfExists = (relativePath) => {
    const source = path.join(REPO_ROOT, relativePath);
    if (!fs.existsSync(source)) return;
    fs.cpSync(source, path.join(target, relativePath), { recursive: true });
  };

  for (const relativePath of ['package.json', 'package-lock.json', 'vercel.json']) {
    copyIfExists(relativePath);
  }

  for (const relativePath of [
    'app/config',
    'app/public',
    'app/scripts',
    'app/src',
    'app/components.json',
    'app/index.html',
    'app/jsconfig.json',
    'app/package.json',
    'app/package-lock.json',
    'app/postcss.config.js',
    'app/tailwind.config.js',
    'app/vercel.json',
    'app/vite.config.js',
  ]) {
    copyIfExists(relativePath);
  }

  renderStagingVercelConfig(target);
  return target;
};

const deployPreview = (cwd, target = 'preview') => {
  const args = [
    'vercel',
    'deploy',
    '--yes',
    ...(target && target !== 'preview' ? ['--target', target] : []),
    '--build-env',
    'VITE_DEPLOY_TARGET=vercel-staging',
    '--build-env',
    'VITE_RELEASE_CHANNEL=staging',
    '--build-env',
    'VITE_API_URL=/api',
    '--build-env',
    `AURA_BACKEND_ORIGIN=${env.stagingApiBaseUrl}`,
    '--build-env',
    `NEXT_PUBLIC_API_BASE_URL=${env.stagingApiBaseUrl}`,
    '--build-env',
    'NEXT_PUBLIC_APP_ENV=staging',
    '--build-env',
    'NEXT_PUBLIC_ENVIRONMENT=staging',
    '--build-env',
    `NEXT_PUBLIC_STAGING_BACKEND_URL=${env.stagingApiBaseUrl}`,
    '--env',
    `AURA_BACKEND_ORIGIN=${env.stagingApiBaseUrl}`,
    ...cliAuthArgs(),
  ];
  const result = runNpx(args, { cwd });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Vercel deploy failed');
  }
  const output = `${result.stdout}\n${result.stderr}`;
  const urls = Array.from(output.matchAll(/https:\/\/[a-zA-Z0-9.-]+\.vercel\.app/g)).map((match) => match[0]);
  return urls.at(-1) || '';
};

const setGithubVar = (key, value) => {
  if (!env.githubRepo || !value) return false;
  const result = run(ghBin, ['variable', 'set', key, '--repo', env.githubRepo, '--env', 'staging'], { input: value });
  if (result.status !== 0) {
    warnings.push(`Could not set GitHub staging variable ${key}: ${result.stderr || result.stdout}`);
    return false;
  }
  return true;
};

const setGithubSecret = (key, value) => {
  if (!env.githubRepo || !value) return false;
  const result = run(ghBin, ['secret', 'set', key, '--repo', env.githubRepo, '--env', 'staging'], { input: value });
  if (result.status !== 0) {
    warnings.push(`Could not set GitHub staging secret ${key}: ${result.stderr || result.stdout}`);
    return false;
  }
  return true;
};

const getProtectionBypassSecret = async () => {
  if (fs.existsSync(protectionBypassPath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(protectionBypassPath, 'utf8'));
      const cachedSecret = Object.keys(cached?.protectionBypass || {}).at(-1) || '';
      if (cachedSecret) {
        warnings.push('Using existing local Vercel automation bypass secret for protected Preview smoke.');
        return cachedSecret;
      }
    } catch {
      // Regenerate below if the local non-committed cache is unreadable.
    }
  }
  try {
    const response = await api(`/v1/projects/${env.projectId}/protection-bypass`, {
      method: 'PATCH',
      body: { generate: {} },
    });
    writeJson(protectionBypassPath, response);
    const secrets = Object.keys(response?.protectionBypass || {});
    const secret = secrets.at(-1) || '';
    if (!secret) {
      warnings.push('Vercel protection bypass API returned no automation secret; protected preview smoke may fail.');
      return '';
    }
    warnings.push('Vercel Deployment Protection is enabled; smoke uses a project automation bypass secret without printing it.');
    return secret;
  } catch (error) {
    warnings.push(`Could not create/read Vercel automation bypass secret: ${error.message || error}`);
    return '';
  }
};

const runFrontendSmoke = (frontendUrl) => {
  const result = run(process.execPath, ['scripts/smoke/assert-frontend-staging-target.mjs'], {
    env: {
      STAGING_FRONTEND_URL: frontendUrl,
      STAGING_API_BASE_URL: env.stagingApiBaseUrl,
      STAGING_HEALTH_URL: env.stagingHealthUrl,
      PROD_BASE_URL: env.prodBaseUrl,
      PROD_API_BASE_URL: env.prodApiBaseUrl,
      VERCEL_AUTOMATION_BYPASS_SECRET: process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '',
    },
  });
  if (result.status !== 0) {
    throw new Error(`${result.stdout}\n${result.stderr}`.trim());
  }
  return result.stdout.trim();
};

ensureStateDir();

let project;
try {
  project = await inspectProject();
} catch (error) {
  const message = `Vercel project cannot be inspected with current token/scope or local CLI auth: ${error.message}`;
  writeBlocker(message, warnings);
  writeJson(resultPath, {
    mode: 'blocked',
    frontendUrl: '',
    backendUrl: env.stagingApiBaseUrl,
    domainAssigned: false,
    warnings,
    blocked: true,
    blocker: message,
  });
  console.error(message);
  process.exit(1);
}

const custom = await tryCreateCustomEnvironment(project);
const mode = custom.ok ? 'custom-environment' : 'preview-branch';
const envTarget = custom.ok ? 'staging' : 'preview';
const envBranch = custom.ok ? '' : 'staging';

const publicVars = {
  NEXT_PUBLIC_API_BASE_URL: env.stagingApiBaseUrl,
  NEXT_PUBLIC_APP_ENV: 'staging',
  NEXT_PUBLIC_ENVIRONMENT: 'staging',
  NEXT_PUBLIC_STAGING_BACKEND_URL: env.stagingApiBaseUrl,
  VITE_API_URL: '/api',
  VITE_DEPLOY_TARGET: 'vercel-staging',
  VITE_RELEASE_CHANNEL: 'staging',
  VITE_STAGING_BACKEND_URL: env.stagingApiBaseUrl,
  AURA_BACKEND_ORIGIN: env.stagingApiBaseUrl,
};

let envWriteOk = true;
for (const [key, value] of Object.entries(publicVars)) {
  if (!setVercelEnv(key, value, envTarget, envBranch)) {
    envWriteOk = false;
    break;
  }
}
if (!envWriteOk) {
  const message = mode === 'preview-branch'
    ? 'Preview branch staging requires successful branch-scoped Vercel env writes; stopping before deploying a Preview URL.'
    : 'Vercel staging requires successful environment writes; stopping before deployment.';
  warnings.push('One or more Vercel staging env writes failed; stopping before deployment.');
  writeBlocker(message, warnings);
  writeJson(resultPath, {
    mode,
    frontendUrl: '',
    backendUrl: env.stagingApiBaseUrl,
    domainAssigned: false,
    warnings,
    blocked: true,
    blocker: message,
  });
  console.error(message);
  process.exit(1);
}

let frontendUrl = '';
let smokeOutput = '';
let protectionBypassConfigured = false;
try {
  const deployRoot = copyForDeploy();
  frontendUrl = deployPreview(deployRoot, custom.ok ? 'staging' : 'preview');
  if (!frontendUrl) throw new Error('Vercel deploy did not return a frontend URL.');
  const protectionBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || await getProtectionBypassSecret();
  if (protectionBypassSecret) {
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = protectionBypassSecret;
    protectionBypassConfigured = true;
  }

  if (env.stagingDomain) {
    const domainResult = runNpx(['vercel', 'domains', 'inspect', env.stagingDomain, ...cliAuthArgs()]);
    if (domainResult.status === 0) {
      warnings.push(`Domain ${env.stagingDomain} exists, but automatic branch assignment is not supported by this autopilot yet.`);
    } else {
      warnings.push(`Domain ${env.stagingDomain} could not be inspected or assigned: ${domainResult.stderr || domainResult.stdout}`);
    }
  }

  smokeOutput = runFrontendSmoke(frontendUrl);
} catch (error) {
  const message = error?.message || 'Vercel staging deployment failed.';
  writeBlocker(message, warnings);
  writeJson(resultPath, {
    mode,
    frontendUrl,
    backendUrl: env.stagingApiBaseUrl,
    domainAssigned: false,
    warnings,
    blocked: true,
    blocker: message,
  });
  console.error(message);
  process.exit(1);
}

setGithubVar('STAGING_FRONTEND_URL', frontendUrl);
setGithubVar('VERCEL_STAGING_FRONTEND_URL', frontendUrl);
if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
  setGithubSecret('VERCEL_AUTOMATION_BYPASS_SECRET', process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
}

writeJson(resultPath, {
  mode,
  frontendUrl,
  backendUrl: env.stagingApiBaseUrl,
  domainAssigned: false,
  warnings,
  blocked: false,
  authMode,
  protectionBypassConfigured,
  smoke: smokeOutput,
});

console.log(`PASS: Vercel staging frontend deployed (${mode})`);
console.log(`frontendUrl=${frontendUrl}`);
console.log(`backendUrl=${env.stagingApiBaseUrl}`);
for (const warning of warnings) console.log(`warning=${warning}`);
