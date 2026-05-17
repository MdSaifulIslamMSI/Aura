import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const repoRoot = process.cwd();
const reportsDir = path.join(repoRoot, 'security-reports');
mkdirSync(reportsDir, { recursive: true });

if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
  throw new Error('Refusing to run Cloudflare activation with NODE_ENV=production');
}

const args = new Set(process.argv.slice(2));
const shouldApply = args.has('--apply');
const getArg = (name) => process.argv.find((arg) => arg.startsWith(`${name}=`))?.split('=').slice(1).join('=') || '';
const zoneName = (getArg('--zone') || process.env.CLOUDFLARE_ZONE_NAME || '').trim();
const zoneIdInput = (getArg('--zone-id') || process.env.CLOUDFLARE_ZONE_ID || '').trim();

const rulesPath = path.join(repoRoot, 'infra/cloudflare/free-security-rules.json');
const rulesConfig = JSON.parse(readFileSync(rulesPath, 'utf8'));

const readWranglerOAuthToken = () => {
  const configPath = path.join(
    process.env.APPDATA || path.join(os.homedir(), '.config'),
    'xdg.config',
    '.wrangler',
    'config',
    'default.toml',
  );
  if (!existsSync(configPath)) return '';
  const config = readFileSync(configPath, 'utf8');
  return config.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1] || '';
};

const token = process.env.CLOUDFLARE_API_TOKEN || readWranglerOAuthToken();
if (!token) {
  throw new Error('Cloudflare token not found. Run `npx wrangler login` or set CLOUDFLARE_API_TOKEN.');
}

const api = async (method, endpoint, body) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4${endpoint}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok && payload.success !== false,
    status: response.status,
    payload,
  };
};

const findZone = async () => {
  if (zoneIdInput) {
    const zone = await api('GET', `/zones/${zoneIdInput}`);
    if (!zone.ok) return { error: 'CLOUDFLARE_ZONE_ID was set but the zone could not be read.', detail: zone.payload?.errors || [] };
    return { zone: zone.payload.result };
  }

  const zones = await api('GET', '/zones?per_page=50');
  if (!zones.ok) return { error: 'Unable to list Cloudflare zones.', detail: zones.payload?.errors || [] };
  const allZones = zones.payload.result || [];
  if (zoneName) {
    const match = allZones.find((zone) => String(zone.name || '').toLowerCase() === zoneName.toLowerCase());
    if (!match) return { error: `No Cloudflare zone found for ${zoneName}.`, zones: allZones.map((zone) => zone.name) };
    return { zone: match };
  }
  if (allZones.length === 1) return { zone: allZones[0] };
  if (allZones.length === 0) return { error: 'No Cloudflare zones are attached to this account yet.' };
  return { error: 'Multiple Cloudflare zones found. Re-run with --zone=<domain> or --zone-id=<id>.', zones: allZones.map((zone) => zone.name) };
};

const getEntrypointRuleset = async (zoneId, phase) => {
  const result = await api('GET', `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`);
  if (result.status === 404) return null;
  if (!result.ok) throw new Error(`Unable to read Cloudflare ${phase} entrypoint ruleset.`);
  return result.payload.result;
};

const upsertEntrypointRules = async (zoneId, phase, name, rules) => {
  const existing = await getEntrypointRuleset(zoneId, phase);
  const mergedRules = [
    ...(existing?.rules || []).filter((rule) => !rules.some((candidate) => candidate.ref && candidate.ref === rule.ref)),
    ...rules.map((rule) => ({
      ...rule,
      enabled: true,
    })),
  ];

  const body = {
    name,
    description: 'Aura marketplace free-tier Cloudflare security rules',
    kind: 'zone',
    phase,
    rules: mergedRules,
  };

  if (!shouldApply) return { ok: true, dryRun: true, rules: mergedRules.length };
  if (existing?.id) {
    return api('PUT', `/zones/${zoneId}/rulesets/${existing.id}`, body);
  }
  return api('POST', `/zones/${zoneId}/rulesets`, body);
};

const report = {
  generatedAt: new Date().toISOString(),
  mode: shouldApply ? 'apply' : 'plan',
  zone: null,
  operations: [],
  warnings: [],
};

const selected = await findZone();
if (selected.error) {
  report.warnings.push(selected);
  writeFileSync(path.join(reportsDir, 'cloudflare-free-security-activation.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = shouldApply ? 1 : 0;
} else {
  const zone = selected.zone;
  report.zone = {
    id: zone.id,
    name: zone.name,
    status: zone.status,
    paused: zone.paused,
    type: zone.type,
  };

  for (const [setting, value] of Object.entries(rulesConfig.zoneSettings || {})) {
    if (!shouldApply) {
      report.operations.push({ type: 'zone_setting', setting, value, status: 'planned' });
      continue;
    }
    const result = await api('PATCH', `/zones/${zone.id}/settings/${setting}`, { value });
    report.operations.push({
      type: 'zone_setting',
      setting,
      value,
      status: result.ok ? 'applied' : 'failed',
      httpStatus: result.status,
      errors: result.ok ? undefined : result.payload?.errors,
    });
  }

  const customRules = (rulesConfig.customWafRules || []).map((rule) => ({
    action: rule.action,
    expression: rule.expression,
    description: rule.description,
    ref: rule.ref,
  }));
  const customResult = await upsertEntrypointRules(zone.id, 'http_request_firewall_custom', 'Aura custom WAF rules', customRules);
  report.operations.push({
    type: 'ruleset',
    phase: 'http_request_firewall_custom',
    status: customResult.ok ? (shouldApply ? 'applied' : 'planned') : 'failed',
    httpStatus: customResult.status,
    errors: customResult.ok ? undefined : customResult.payload?.errors,
  });

  const rateLimitRules = (rulesConfig.rateLimitRules || []).map((rule) => ({
    action: 'block',
    expression: rule.expression,
    description: rule.description,
    ref: rule.ref,
    ratelimit: {
      characteristics: ['ip.src'],
      period: rule.period,
      requests_per_period: rule.requests_per_period,
      mitigation_timeout: rule.mitigation_timeout,
    },
  }));
  const rateLimitResult = await upsertEntrypointRules(zone.id, 'http_ratelimit', 'Aura rate limiting rules', rateLimitRules);
  report.operations.push({
    type: 'ruleset',
    phase: 'http_ratelimit',
    status: rateLimitResult.ok ? (shouldApply ? 'applied' : 'planned') : 'failed',
    httpStatus: rateLimitResult.status,
    errors: rateLimitResult.ok ? undefined : rateLimitResult.payload?.errors,
  });

  const failed = report.operations.filter((operation) => operation.status === 'failed');
  writeFileSync(path.join(reportsDir, 'cloudflare-free-security-activation.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}
