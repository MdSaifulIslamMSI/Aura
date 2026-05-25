import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const requiredFiles = [
  'docs/security/security-architecture.md',
  'docs/security/security-inventory.md',
  'docs/security/threat-model.md',
  'docs/security/risk-register.md',
  'docs/security/control-gap-tracker.md',
  'docs/security/baseline-scan-results.md',
  'docs/security/release-watch-plan.md',
  'docs/security/incident-response.md',
  'docs/security/data-flow-map.md',
  'docs/security/access-review.md',
  'security/policies/security-evidence-standard.md',
  'security/policies/branch-protection.md',
  'security/policies/runtime-hardening.md',
  'security/policies/zero-trust-service-mesh.md',
  'security/policies/iac-security.md',
  'security/policies/supply-chain-provenance.md',
  'security/policies/data-governance-dlp.md',
  'security/policies/vulnerability-management.md',
  'security/policies/security-testing-depth.md',
  'security/policies/abuse-fraud-detection.md',
  'security/detections/security-alert-rules.yml',
  'security/detections/falco-runtime-rules.yml',
  '.github/CODEOWNERS',
  '.github/workflows/security-gates.yml',
];

const requiredPlaybooks = [
  'account-takeover.md',
  'malware-upload.md',
  'secret-leak.md',
  'ssrf-attempt.md',
  'tenant-data-leak.md',
  'admin-abuse.md',
  'dependency-zero-day.md',
  'ransomware-backup-restore.md',
  'production-regression.md',
].map((name) => `security/playbooks/${name}`);

const allRequired = [...requiredFiles, ...requiredPlaybooks];
const missing = allRequired.filter((file) => !existsSync(path.join(repoRoot, file)));

const contentChecks = [
  {
    file: 'docs/security/control-gap-tracker.md',
    needles: ['Threat', 'Prevent Control', 'CI Gate', 'Playbook', 'Evidence Status'],
  },
  {
    file: 'docs/security/security-inventory.md',
    needles: ['## Edge', '## Identity', '## Supply Chain', '## Monitoring'],
  },
  {
    file: '.github/workflows/security-gates.yml',
    needles: ['Security Gates', 'SBOM', 'Secret Scan', 'Evidence Check', 'IaC Security Scan', 'Supply Chain Integrity'],
  },
  {
    file: 'docs/security/security-architecture.md',
    needles: ['Threat Modeling', 'Zero Trust Service Mesh', 'Runtime Container Security', 'Data Governance'],
  },
  {
    file: 'docs/security/threat-model.md',
    needles: ['## Abuse Cases', '## STRIDE Matrix', '## Threat To Risk Register Map'],
  },
];

const failedContent = [];
for (const check of contentChecks) {
  const filePath = path.join(repoRoot, check.file);
  if (!existsSync(filePath)) continue;
  const content = readFileSync(filePath, 'utf8');
  for (const needle of check.needles) {
    if (!content.includes(needle)) {
      failedContent.push(`${check.file} missing "${needle}"`);
    }
  }
}

if (missing.length > 0 || failedContent.length > 0) {
  if (missing.length > 0) {
    console.error('[security:evidence] Missing required evidence files:');
    for (const file of missing) console.error(`- ${file}`);
  }
  if (failedContent.length > 0) {
    console.error('[security:evidence] Failed content checks:');
    for (const failure of failedContent) console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`[security:evidence] ${allRequired.length} evidence files present.`);
