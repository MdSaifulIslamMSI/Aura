import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { buildRouteExposureInventory, repoRoot } = require('../../server/security/invisibleFabric/routeDiscovery');
const { ROUTE_CLASSIFICATIONS } = require('../../server/security/invisibleFabric/routeExposureRegistry');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..', '..');
const update = process.argv.includes('--update');
const reportDir = path.join(root, 'reports', 'security');
const manifestPath = path.join(root, 'server', 'security', 'invisibleFabric', 'routeExposureManifest.json');

const readIfExists = (relativePath) => {
    const absolutePath = path.join(root, relativePath);
    return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
};

const evidenceSource = [
    'server/routes',
    'server/controllers',
    'server/middleware',
    'server/security',
    'server/services/payments',
    'server/services/statusWebhookService.js',
].map((relativePath) => {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) return '';
    if (fs.statSync(absolutePath).isFile()) return fs.readFileSync(absolutePath, 'utf8');
    return fs.readdirSync(absolutePath)
        .filter((file) => file.endsWith('.js'))
        .map((file) => fs.readFileSync(path.join(absolutePath, file), 'utf8'))
        .join('\n');
}).join('\n');

const hasWebhookVerificationEvidence = (route) => {
    const routePath = route.path.toLowerCase();
    if (routePath.includes('stripe')) return /constructEvent|stripe.*webhook|STRIPE_WEBHOOK_SECRET|verify.*stripe/i.test(evidenceSource);
    if (routePath.includes('razorpay')) return /validateWebhookSignature|RAZORPAY_WEBHOOK_SECRET|verify.*razorpay|signature/i.test(evidenceSource);
    if (routePath.includes('resend')) return /svix|RESEND_WEBHOOK_SECRET|webhook\.verify|svix-signature/i.test(evidenceSource);
    if (routePath.includes('/api/status/webhooks')) return /STATUS_WEBHOOK_SECRET|STATUS_WEBHOOK_TOKEN|verify.*webhook|webhook.*token/i.test(evidenceSource);
    return /signature|webhook.*secret|webhook.*verify|token/i.test(evidenceSource);
};

const hasSensitivePolicyEvidence = (route) => {
    const source = readIfExists(route.file);
    return /protect|admin|sensitiveActions|authorizeResource|authShield|internal(?:Job|Ai)Auth|requireSensitiveAction|csrf|rateLimit/i.test(source);
};

const buildManifest = (inventory) => {
    const routes = inventory.map(({ method, path: routePath, file, exposure }) => ({
        method,
        route: routePath,
        file,
        classification: exposure?.classification || 'unclassified',
        authRequired: Boolean(exposure?.authRequired),
        adminRequired: Boolean(exposure?.adminRequired),
        mfaRequired: Boolean(exposure?.mfaRequired),
        csrfRequired: Boolean(exposure?.csrfRequired),
        replayGuardRequired: Boolean(exposure?.replayGuardRequired),
        rateLimitRequired: Boolean(exposure?.rateLimitRequired),
        resourceAuthorizationRequired: Boolean(exposure?.resourceAuthorizationRequired),
        publiclyDiscoverable: Boolean(exposure?.publiclyDiscoverable),
        signatureVerificationRequired: Boolean(exposure?.signatureVerificationRequired),
        notes: exposure?.notes || '',
    }));
    const hash = crypto
        .createHash('sha256')
        .update(JSON.stringify(routes))
        .digest('hex');
    return {
        generatedBy: 'scripts/security/invisible-route-exposure.mjs',
        schemaVersion: 1,
        routeCount: routes.length,
        hash,
        routes,
    };
};

const inventory = buildRouteExposureInventory();
const manifest = buildManifest(inventory);
const issues = [];

for (const route of inventory) {
    const exposure = route.exposure;
    if (!exposure) {
        issues.push({ route: route.key, issue: 'route_missing_classification', file: route.file });
        continue;
    }
    if (exposure.classification === ROUTE_CLASSIFICATIONS.ADMIN && exposure.publiclyDiscoverable) {
        issues.push({ route: route.key, issue: 'admin_route_publicly_discoverable', file: route.file });
    }
    if (exposure.classification === ROUTE_CLASSIFICATIONS.INTERNAL && exposure.publiclyDiscoverable) {
        issues.push({ route: route.key, issue: 'internal_route_publicly_discoverable', file: route.file });
    }
    if (exposure.signatureVerificationRequired && !hasWebhookVerificationEvidence(route)) {
        issues.push({ route: route.key, issue: 'webhook_missing_signature_verification_marker', file: route.file });
    }
    if (
        exposure.resourceAuthorizationRequired
        && !hasSensitivePolicyEvidence(route)
        && exposure.classification !== ROUTE_CLASSIFICATIONS.WEBHOOK
    ) {
        issues.push({ route: route.key, issue: 'sensitive_route_missing_policy_marker', file: route.file });
    }
    if (/\/debug(?:\/|$)/i.test(route.path) && exposure.classification !== ROUTE_CLASSIFICATIONS.HONEYPOT) {
        const indexSource = readIfExists('server/index.js');
        if (!indexSource.includes('blockProductionDebugRoutes')) {
            issues.push({ route: route.key, issue: 'production_debug_route_without_global_blocker', file: route.file });
        }
    }
}

if (update) {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (!fs.existsSync(manifestPath)) {
    issues.push({ route: '*', issue: 'route_manifest_missing', file: path.relative(root, manifestPath).replace(/\\/g, '/') });
} else {
    const current = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (current.hash !== manifest.hash || current.routeCount !== manifest.routeCount) {
        issues.push({ route: '*', issue: 'route_manifest_stale_run_with_update', file: path.relative(root, manifestPath).replace(/\\/g, '/') });
    }
}

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, 'invisible-route-exposure.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    repoRoot: repoRoot.replace(/\\/g, '/'),
    manifest,
    issues,
}, null, 2));

if (issues.length > 0) {
    console.error(`Invisible route exposure check failed with ${issues.length} issue(s).`);
    for (const issue of issues) {
        console.error(`- ${issue.route}: ${issue.issue}${issue.file ? ` (${issue.file})` : ''}`);
    }
    process.exit(1);
}

console.log(`Invisible route exposure check passed for ${manifest.routeCount} routes.`);
