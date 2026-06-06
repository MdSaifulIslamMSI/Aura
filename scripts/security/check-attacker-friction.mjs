import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { scanSensitiveRoutes } from './check-sensitive-routes.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..', '..');

const requiredFiles = [
    'server/security/securityDecisionEngine.js',
    'server/security/riskScoringService.js',
    'server/security/actionSensitivityPolicy.js',
    'server/security/securityEventLogger.js',
    'server/security/securityDecisionTypes.js',
    'server/security/securityContextBuilder.js',
    'server/security/sensitiveActionRegistry.js',
    'server/security/freshAuthService.js',
    'server/security/resourceAuthorizationService.js',
    'server/security/containmentService.js',
    'server/security/canaryService.js',
    'server/middleware/requireSecurityDecision.js',
    'server/middleware/requireFreshAuth.js',
    'server/middleware/requireTenantBoundary.js',
    'server/middleware/requireObjectOwnership.js',
    'server/middleware/securityAuditMiddleware.js',
    'server/middleware/adaptiveRateLimit.js',
    'server/routes/securityCanaryRoutes.js',
    'config/security/sensitive-route-exceptions.json',
];

const checkRequiredFiles = () => requiredFiles
    .filter((relativePath) => !fs.existsSync(path.join(repoRoot, relativePath)))
    .map((relativePath) => `Missing required file: ${relativePath}`);

const checkRegistry = () => {
    const {
        getSensitiveActionPolicy,
        listSensitiveActions,
    } = require(path.join(repoRoot, 'server/security/sensitiveActionRegistry.js'));
    const errors = [];
    const requiredActions = [
        'admin.role.change',
        'payment.refund',
        'data.export',
        'auth.mfa.disable',
        'upload.remoteFetch',
    ];

    for (const action of requiredActions) {
        const policy = getSensitiveActionPolicy(action);
        if (!policy) {
            errors.push(`Missing sensitive action policy: ${action}`);
            continue;
        }
        if (policy.sensitivity === 'critical' && !policy.requiresAudit) {
            errors.push(`Critical action lacks audit requirement: ${action}`);
        }
        if (policy.sensitivity === 'critical' && !policy.requiresFreshAuth) {
            errors.push(`Critical action lacks fresh-auth requirement: ${action}`);
        }
    }

    if (listSensitiveActions().length < 25) {
        errors.push('Sensitive action registry is unexpectedly small');
    }

    return errors;
};

const main = () => {
    const errors = [
        ...checkRequiredFiles(),
        ...checkRegistry(),
    ];

    const routeScan = scanSensitiveRoutes();
    errors.push(...routeScan.exceptionErrors);
    errors.push(...routeScan.findings.map((finding) => `${finding.key}: ${finding.reason}`));

    if (errors.length) {
        console.error('Attacker-friction security check failed:');
        for (const error of errors) console.error(`- ${error}`);
        process.exitCode = 1;
        return;
    }

    console.log('Attacker-friction security check passed');
};

if (process.argv[1] === __filename) {
    main();
}
