import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const normalize = (value = '') => String(value === undefined || value === null ? '' : value).trim();

export const normalizeUrl = (value = '') => normalize(value).replace(/\/+$/, '');

export const isTruthy = (value = '') => ['1', 'true', 'yes', 'on'].includes(normalize(value).toLowerCase());

export const readJsonIfExists = (file) => {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

export const writeJsonAtomic = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
};

export const parseDotEnv = (text = '') => {
  const entries = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [rawName, ...rest] = line.split('=');
    const name = rawName.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let value = rest.join('=').trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries[name] = value;
  }
  return entries;
};

export const loadEnvFile = (file, { override = false } = {}) => {
  if (!fs.existsSync(file)) return [];
  const entries = parseDotEnv(fs.readFileSync(file, 'utf8'));
  const loaded = [];
  for (const [name, value] of Object.entries(entries)) {
    if (!override && normalize(process.env[name])) continue;
    process.env[name] = value;
    loaded.push(name);
  }
  return loaded;
};

export const loadLocalAwsEnv = () => {
  loadEnvFile(path.join(repoRoot, '.env.staging.local'));
  loadEnvFile(path.join(repoRoot, '.env.local'));
};

export const run = (command, args = [], options = {}) => {
  try {
    const stdout = execFileSync(command, args, {
      cwd: options.cwd || repoRoot,
      encoding: 'utf8',
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '', status: 0 };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout || ''),
      stderr: String(error.stderr || error.message || ''),
      status: error.status || 1,
    };
  }
};

export const runRequired = (command, args = [], options = {}) => {
  const result = run(command, args, options);
  if (!result.ok) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
};

export const runJson = (command, args = [], options = {}) => {
  const output = runRequired(command, args, options);
  return output ? JSON.parse(output) : null;
};

export const runAws = (args = [], options = {}) => run('aws', args, options);

export const runAwsJson = (args = [], options = {}) => {
  const result = runAws([...args, '--output', 'json'], options);
  if (!result.ok) return { ...result, data: null };
  try {
    return { ...result, data: result.stdout ? JSON.parse(result.stdout) : null };
  } catch (error) {
    return { ok: false, stdout: result.stdout, stderr: error.message, status: 1, data: null };
  }
};

export const resolveAwsRegion = () => {
  const configured = normalize(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION);
  if (configured) return configured;
  const result = run('aws', ['configure', 'get', 'region']);
  return normalize(result.stdout) || 'ap-south-1';
};

export const gitSha = () => normalize(runRequired('git', ['rev-parse', 'HEAD']));

export const gitBranch = () => normalize(runRequired('git', ['rev-parse', '--abbrev-ref', 'HEAD']));

export const gitStatusShort = () => runRequired('git', ['status', '--short']);

export const sha256File = (file) => {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
};

export const evidenceDir = path.join(repoRoot, 'artifacts', 'release-gates');

export const writeEvidence = (name, data) => {
  const file = path.join(evidenceDir, `${name}.json`);
  writeJsonAtomic(file, {
    ...data,
    gitSha: data.gitSha || gitSha(),
    generatedAt: new Date().toISOString(),
  });
  return file;
};

export const readEvidence = (name) => readJsonIfExists(path.join(evidenceDir, `${name}.json`));

export const getUrlHost = (value = '') => {
  try {
    return new URL(normalize(value)).hostname.toLowerCase();
  } catch {
    return '';
  }
};

export const redactError = (value = '') => {
  const text = normalize(value);
  if (!text) return '';
  return text
    .replace(/(AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|AWS_ACCESS_KEY_ID)=\S+/gi, '$1=<redacted>')
    .replace(/(token|secret|password|private[_-]?key)["'=:\s]+[A-Za-z0-9/+_.=-]{12,}/gi, '$1=<redacted>');
};

export const currentMonthWindow = () => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const fmt = (date) => date.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
};

export const currentForecastWindow = () => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const fmt = (date) => date.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
};

export const tempFile = (name) => path.join(os.tmpdir(), `${name}-${process.pid}-${Date.now()}`);
