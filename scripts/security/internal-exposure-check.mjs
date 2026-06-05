import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const reportDir = path.join(root, 'reports', 'security');
const filesToInspect = [
    'config/environments/production.example.env',
    'config/environments/staging.example.env',
    'docker-compose.yml',
    'Dockerfile',
    'netlify.toml',
    'vercel.json',
];

const highRiskPatterns = [
    ['docker-daemon-public', /tcp:\/\/0\.0\.0\.0:2375/i],
    ['mongodb-public-bind', /(?:mongo|mongodb).*0\.0\.0\.0:27017/i],
    ['redis-public-bind', /(?:redis).*0\.0\.0\.0:6379/i],
    ['grafana-public-default-admin', /GRAFANA_ADMIN_PASSWORD\s*=\s*(?:admin|password)/i],
    ['prometheus-public-route', /\/prometheus(?:\s|$)/i],
    ['phpmyadmin-public', /phpmyadmin/i],
    ['adminer-public', /adminer/i],
    ['kibana-public', /kibana/i],
];

const warnings = [];
const failures = [];

for (const relativeFile of filesToInspect) {
    const absoluteFile = path.join(root, relativeFile);
    if (!fs.existsSync(absoluteFile)) continue;
    const text = fs.readFileSync(absoluteFile, 'utf8');
    for (const [ruleId, pattern] of highRiskPatterns) {
        if (pattern.test(text)) {
            failures.push({ file: relativeFile, ruleId });
        }
    }
}

const requiredDocs = [
    'docs/security/internal-service-darkening.md',
    'docs/security/invisible-origin.md',
];
for (const relativeFile of requiredDocs) {
    if (!fs.existsSync(path.join(root, relativeFile))) {
        warnings.push({ file: relativeFile, ruleId: 'required_darkening_doc_missing' });
    }
}

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, 'internal-exposure-check.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    failures,
    warnings,
}, null, 2));

if (failures.length > 0) {
    console.error(`Internal exposure check failed with ${failures.length} high-confidence issue(s).`);
    for (const failure of failures) {
        console.error(`- ${failure.file}: ${failure.ruleId}`);
    }
    process.exit(1);
}

for (const warning of warnings) {
    console.warn(`Warning: ${warning.file}: ${warning.ruleId}`);
}
console.log('Internal exposure check passed.');
