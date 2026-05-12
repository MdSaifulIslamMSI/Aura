import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const read = (relativePath) => {
  const absolutePath = join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing required login architecture asset: ${relativePath}`);
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

const controls = [
  {
    name: 'production observability',
    path: 'infra/observability/prometheus/alerts/login-security.yml',
    patterns: [/aura_auth_security_events_total/, /AuraAuthLoginFailureSpike/],
  },
  {
    name: 'edge perimeter WAF',
    path: 'infra/aws/waf-login-security-cloudfront.yml',
    patterns: [/AWS::WAFv2::WebACL/, /AWSManagedRulesCommonRuleSet/, /RateBasedStatement/, /Scope:\s*CLOUDFRONT/],
  },
  {
    name: 'login risk engine',
    path: 'server/services/authRiskEngineService.js',
    patterns: [/evaluateLoginRisk/, /failed_login_velocity/, /impossible_travel/, /ip_denylist/],
  },
  {
    name: 'consumer provider breadth',
    path: 'app/src/config/firebase.js',
    patterns: [/microsoftProvider/, /appleProvider/, /VITE_FIREBASE_ENABLE_MICROSOFT_AUTH/, /VITE_FIREBASE_ENABLE_APPLE_AUTH/],
  },
  {
    name: 'enterprise provider decision policy',
    path: 'server/config/authProviderPolicy.js',
    patterns: [/enterprise_oidc/, /enterprise_saml/, /design_required/],
  },
  {
    name: 'authorization policy',
    path: 'server/config/authorizationPolicy.js',
    patterns: [/admin\.users\.delete/, /auth\.recovery_codes\.issue/, /passkey_or_second_factor/],
  },
  {
    name: 'privacy inventory',
    path: 'server/config/privacyDataInventory.js',
    patterns: [/identity/, /commerce/, /observability/, /erasable/],
  },
  {
    name: 'DR and HA runbook',
    path: 'docs/auth-dr-ha-runbook.md',
    patterns: [/RTO\/RPO/, /Redis sessions/, /restore/i],
  },
  {
    name: 'auth security outbox',
    path: 'server/services/authSecurityEventOutboxService.js',
    patterns: [/getLoginRuntimeEnforcementPolicy/, /enqueueAuthSecurityEvent/, /auth\.security/],
  },
  {
    name: 'privileged access policy',
    path: 'server/config/privilegedAccessPolicy.js',
    patterns: [/jitAccessEnabled/, /approvalRequiredFor/, /admin\.ops\.maintenance/],
  },
  {
    name: 'runtime enforcement policy',
    path: 'server/config/loginRuntimeEnforcementPolicy.js',
    patterns: [/AUTH_RISK_ENGINE_MODE/, /AUTH_SECURITY_OUTBOX_ENABLED/, /PRIVILEGED_JIT_ACCESS_ENABLED/, /monitor/, /enforce/],
  },
  {
    name: 'staging and production activation runbook',
    path: 'docs/login-staging-production-activation.md',
    patterns: [/security:login-live-readiness/, /CloudFront/, /AUTH_RISK_ENGINE_MODE=monitor/, /PRIVILEGED_JIT_ACCESS_ENABLED=false/],
  },
  {
    name: 'live readiness checker',
    path: 'scripts/validate-login-live-readiness.mjs',
    patterns: [/AURA_CLOUDFRONT_DISTRIBUTION_ID/, /GRAFANA_ADMIN_PASSWORD/, /--strict/],
  },
];

for (const control of controls) {
  requirePatterns(control.name, read(control.path), control.patterns);
}

requirePatterns('next 10 status', read('docs/login-next-10-status-2026-05-09.md'), [
  /Production observability activation/,
  /Edge\/perimeter security/,
  /Login risk engine lite/,
  /Microsoft\/Apple providers/,
  /Enterprise SSO\/OIDC\/SAML/,
  /Authorization model/,
  /Privacy\/compliance workflows/,
  /DR\/HA/,
  /Auth security event bus\/outbox/,
  /Privileged admin access/,
  /Remaining Live Work/,
]);

console.log('Login architecture next-10 assets OK: all 10 areas have repo-owned coverage.');
