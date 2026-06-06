const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const DEFAULT_ROUTE_DIR = path.join(repoRoot, 'server', 'routes');
const DEFAULT_EXCEPTIONS_FILE = path.join(repoRoot, 'config', 'security', 'sensitive-route-exceptions.json');

const SENSITIVE_PATTERNS = [
    /admin/i,
    /refund/i,
    /payment/i,
    /export/i,
    /upload/i,
    /webhook/i,
    /api[-_ ]?key/i,
    /mfa/i,
    /passkey/i,
    /password/i,
    /email/i,
    /role/i,
    /permission/i,
    /tenant/i,
    /database/i,
    /maintenance/i,
    /delete/i,
    /bulk/i,
];

const APPROVED_CONTROL_PATTERNS = [
    /requireSecurityDecision\s*\(/,
    /requireSensitiveAction\s*\(/,
    /authShieldMiddleware\s*\(/,
    /routeSensitiveAction\s*\(/,
    /sensitiveActions\.[A-Za-z0-9_]+/,
    /authorizeResource\s*\(/,
    /authorize[A-Za-z0-9_]*Owner/,
    /csrfTokenValidator/,
    /csrfTokenValidatorUnlessBearerAuth/,
    /createDistributedRateLimit\s*\(/,
    /adaptiveRateLimit\s*\(/,
    /\bprotect\b/,
    /\badmin\b/,
    /requireAdmin/,
    /verify.*Signature/i,
    /webhook.*Signature/i,
    /validate\s*\(/,
];

const routeDeclarationPattern = /\brouter\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*([`'"])([^`'"]+)\2/gi;

const readJson = (filePath) => {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(parsed)) {
        throw new Error(`${path.relative(repoRoot, filePath)} must be an array`);
    }
    return parsed;
};

const listRouteFiles = (dir = DEFAULT_ROUTE_DIR) => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) => {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) return listRouteFiles(fullPath);
            return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
        });
};

const hasApprovedControl = (text = '') => (
    APPROVED_CONTROL_PATTERNS.some((pattern) => pattern.test(text))
);

const isSensitiveRoute = ({ filePath, method, route }) => {
    const haystack = `${path.basename(filePath)} ${method} ${route}`;
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(haystack));
};

const validateException = (exception = {}) => {
    const missing = ['route', 'reason', 'owner'].filter((key) => !String(exception[key] || '').trim());
    const hasReview = Boolean(String(exception.expiry || exception.reviewDate || '').trim());
    if (missing.length || !hasReview) {
        return `Invalid exception for ${exception.route || '(missing route)'}: missing ${[
            ...missing,
            ...(hasReview ? [] : ['expiry or reviewDate']),
        ].join(', ')}`;
    }
    return '';
};

const exceptionKey = ({ filePath, method, route }) => `${path.relative(repoRoot, filePath).replace(/\\/g, '/')}:${method.toUpperCase()}:${route}`;

const scanSensitiveRoutes = ({
    routeDir = DEFAULT_ROUTE_DIR,
    exceptionsFile = DEFAULT_EXCEPTIONS_FILE,
} = {}) => {
    const exceptions = readJson(exceptionsFile);
    const exceptionErrors = exceptions.map(validateException).filter(Boolean);
    const exceptionMap = new Map(exceptions.map((entry) => [String(entry.route || '').trim(), entry]));
    const findings = [];

    for (const filePath of listRouteFiles(routeDir)) {
        const text = fs.readFileSync(filePath, 'utf8');
        const fileHasApprovedControl = hasApprovedControl(text);
        routeDeclarationPattern.lastIndex = 0;

        for (const match of text.matchAll(routeDeclarationPattern)) {
            const method = match[1].toUpperCase();
            const route = match[3];
            const routeInfo = { filePath, method, route };
            if (!isSensitiveRoute(routeInfo)) continue;

            const key = exceptionKey(routeInfo);
            const exception = exceptionMap.get(key);
            if (exception) continue;

            const localStart = Math.max(0, match.index - 300);
            const localEnd = Math.min(text.length, match.index + 800);
            const localText = text.slice(localStart, localEnd);
            if (hasApprovedControl(localText) || fileHasApprovedControl) continue;

            findings.push({
                file: path.relative(repoRoot, filePath).replace(/\\/g, '/'),
                method,
                route,
                key,
                reason: 'sensitive route lacks requireSecurityDecision or an approved equivalent middleware',
            });
        }
    }

    return {
        ok: findings.length === 0 && exceptionErrors.length === 0,
        findings,
        exceptionErrors,
        routeDir,
        exceptionsFile,
    };
};

module.exports = {
    APPROVED_CONTROL_PATTERNS,
    SENSITIVE_PATTERNS,
    exceptionKey,
    hasApprovedControl,
    isSensitiveRoute,
    scanSensitiveRoutes,
};
