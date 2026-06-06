import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { scanFrontendForSecrets } = require('./frontend-secretless-scanner.cjs');

const root = process.cwd();
const reportDir = path.join(root, 'reports', 'security');
const includeBuild = !process.argv.includes('--source-only');
const findings = scanFrontendForSecrets({
    appRoot: path.join(root, 'app'),
    includeBuild,
});

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, 'frontend-secretless-scan.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    includeBuild,
    findingCount: findings.length,
    findings,
}, null, 2));

if (findings.length > 0) {
    console.error(`Frontend secretless scan failed with ${findings.length} finding(s).`);
    for (const finding of findings) {
        console.error(`- ${finding.filePath}:${finding.line} ${finding.ruleId} ${finding.keyword} ${finding.sample}`);
    }
    process.exit(1);
}

console.log(`Frontend secretless scan passed${includeBuild ? ' including build output' : ''}.`);
