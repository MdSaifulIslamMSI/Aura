const fs = require('fs');
const path = require('path');

const FORBIDDEN_KEYWORDS = Object.freeze([
    'DATABASE_URL',
    'PRIVATE_KEY',
    'SECRET',
    'ADMIN_TOKEN',
    'JWT_SECRET',
    'FIREBASE_ADMIN',
    'STRIPE_SECRET',
    'RAZORPAY_SECRET',
    'OPENAI_API_KEY',
    'AWS_SECRET_ACCESS_KEY',
    'MONGODB_URI',
    'REDIS_URL',
    'SESSION_SECRET',
]);

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.html', '.css']);
const BUILD_EXTENSIONS = new Set(['.js', '.css', '.html', '.json', '.map', '.txt']);
const IGNORED_DIRS = new Set(['node_modules', '.git', 'coverage']);

const normalizePath = (value = '') => String(value || '').replace(/\\/g, '/');

const isIsolatedTestFixture = (filePath = '', text = '') => {
    const normalized = normalizePath(filePath).toLowerCase();
    return normalized.includes('/__fixtures__/')
        || normalized.includes('/fixtures/')
        || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)
        || text.includes('@invisible-fabric-test-fixture');
};

const maskValue = (value = '') => {
    const raw = String(value || '');
    if (raw.length <= 8) return '[MASKED]';
    return `${raw.slice(0, 4)}...[MASKED]...${raw.slice(-2)}`;
};

const buildFinding = ({ filePath, ruleId, keyword, value = '', line = 1 } = {}) => ({
    filePath: normalizePath(filePath),
    ruleId,
    keyword,
    line,
    sample: value ? maskValue(value) : keyword,
});

const lineNumberForIndex = (text = '', index = 0) => text.slice(0, index).split(/\r?\n/).length;

const scanText = ({ text = '', filePath = '', mode = 'source' } = {}) => {
    if (mode === 'source' && isIsolatedTestFixture(filePath, text)) return [];

    const findings = [];
    const keywordAlternation = FORBIDDEN_KEYWORDS.map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const derivedKeyPattern = '[A-Z0-9_]+(?:_SECRET|_PRIVATE_KEY|_ADMIN_TOKEN|_JWT_SECRET|_MONGODB_URI|_REDIS_URL|_DATABASE_URL)';
    const envAccess = new RegExp(`\\b(?:import\\.meta\\.env|process\\.env)\\.(${keywordAlternation}|${derivedKeyPattern})\\b`, 'g');
    const assignment = new RegExp(`\\b(${keywordAlternation}|${derivedKeyPattern})\\b\\s*[:=]\\s*["'\`]([^"'\`\\r\\n]{8,})["'\`]`, 'g');
    const valuePatterns = [
        ['private-key-block', /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g],
        ['openai-api-key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
        ['mongodb-uri-with-credentials', /\bmongodb(?:\+srv)?:\/\/[^:\s/]+:[^@\s/]+@/gi],
        ['redis-uri-with-credentials', /\bredis(?:s)?:\/\/[^:\s/]+:[^@\s/]+@/gi],
        ['stripe-secret-key', /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
    ];

    for (const match of text.matchAll(envAccess)) {
        findings.push(buildFinding({
            filePath,
            ruleId: 'frontend-forbidden-env-access',
            keyword: match[1],
            line: lineNumberForIndex(text, match.index),
        }));
    }

    for (const match of text.matchAll(assignment)) {
        findings.push(buildFinding({
            filePath,
            ruleId: 'frontend-forbidden-secret-assignment',
            keyword: match[1],
            value: match[2],
            line: lineNumberForIndex(text, match.index),
        }));
    }

    for (const [ruleId, regex] of valuePatterns) {
        for (const match of text.matchAll(regex)) {
            findings.push(buildFinding({
                filePath,
                ruleId,
                keyword: ruleId,
                value: match[0],
                line: lineNumberForIndex(text, match.index),
            }));
        }
    }

    if (mode === 'build') {
        const buildKeyword = new RegExp(`\\b(${keywordAlternation})\\b`, 'g');
        for (const match of text.matchAll(buildKeyword)) {
            findings.push(buildFinding({
                filePath,
                ruleId: 'frontend-build-forbidden-keyword',
                keyword: match[1],
                line: lineNumberForIndex(text, match.index),
            }));
        }
    }

    return findings;
};

const walkFiles = (rootDir, extensions, files = []) => {
    if (!fs.existsSync(rootDir)) return files;
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!IGNORED_DIRS.has(entry.name)) {
                walkFiles(path.join(rootDir, entry.name), extensions, files);
            }
            continue;
        }
        if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
            files.push(path.join(rootDir, entry.name));
        }
    }
    return files;
};

const scanFrontendForSecrets = ({
    appRoot = path.join(process.cwd(), 'app'),
    includeBuild = true,
} = {}) => {
    const findings = [];
    const sourceRoots = [
        path.join(appRoot, 'src'),
        path.join(appRoot, 'public'),
        path.join(appRoot, 'index.html'),
        path.join(appRoot, 'vite.config.js'),
    ];

    for (const sourceRoot of sourceRoots) {
        const files = fs.existsSync(sourceRoot) && fs.statSync(sourceRoot).isFile()
            ? [sourceRoot]
            : walkFiles(sourceRoot, SOURCE_EXTENSIONS);
        for (const filePath of files) {
            findings.push(...scanText({
                text: fs.readFileSync(filePath, 'utf8'),
                filePath: path.relative(process.cwd(), filePath),
                mode: 'source',
            }));
        }
    }

    if (includeBuild) {
        const distRoot = path.join(appRoot, 'dist');
        for (const filePath of walkFiles(distRoot, BUILD_EXTENSIONS)) {
            findings.push(...scanText({
                text: fs.readFileSync(filePath, 'utf8'),
                filePath: path.relative(process.cwd(), filePath),
                mode: 'build',
            }));
        }
    }

    return findings;
};

module.exports = {
    FORBIDDEN_KEYWORDS,
    isIsolatedTestFixture,
    maskValue,
    scanFrontendForSecrets,
    scanText,
};
