import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const read = (relativePath) => {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing edge security asset: ${relativePath}`);
  }
  return readFileSync(absolutePath, 'utf8');
};

const requirePatterns = (name, text, patterns) => {
  for (const pattern of patterns) {
    if (!pattern.test(text)) {
      throw new Error(`${name} is missing expected pattern: ${pattern}`);
    }
  }
};

requirePatterns('NGINX auth rate limit config', read('infra/edge/nginx/auth-rate-limit.conf'), [
  /limit_req_zone/,
  /aura_login_ip/,
  /aura_signup_ip/,
  /aura_recovery_ip/,
  /aura_refresh_ip/,
  /aura_admin_ip/,
  /proxy_pass http:\/\/aura_waf/,
]);

requirePatterns('OWASP CRS compose template', read('infra/edge/modsecurity-crs/docker-compose.example.yml'), [
  /owasp\/modsecurity-crs:nginx/,
  /MODSEC_RULE_ENGINE:\s+"On"/,
  /BLOCKING_PARANOIA/,
  /BACKEND:\s+http:\/\/api:5000/,
]);

requirePatterns('ModSecurity CRS overrides', read('infra/edge/modsecurity-crs/crs-overrides.conf'), [
  /SecRuleEngine On/,
  /SecRequestBodyAccess On/,
  /SecAuditLogParts/,
]);

requirePatterns('CrowdSec acquisition config', read('infra/edge/crowdsec/acquis.yaml'), [
  /type: nginx/,
  /type: caddy/,
]);

requirePatterns('Edge security README', read('infra/edge/README.md'), [
  /OWASP CRS/,
  /CrowdSec/,
  /STAGING_URL/,
]);

console.log('Edge security assets OK: NGINX rate limits, OWASP CRS, and CrowdSec templates are present.');
