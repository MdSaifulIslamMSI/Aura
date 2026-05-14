'use strict';

const { execFileSync } = require('child_process');
const { buildCountReport } = require('./matrix-engine');

const RISK_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const RULES = [
    {
        riskLevel: 'CRITICAL',
        autoExpandLevel: 'level_4_critical',
        recommendedCommand: 'npm run test:auth:critical',
        estimatedTests: '500000+',
        reason: 'Critical token, session, OTP, RBAC, recovery, or production security boundary changed.',
        patterns: [
            /jwt/i,
            /token/i,
            /refresh/i,
            /role.*middleware/i,
            /authMiddleware/i,
            /admin.*route/i,
            /permission/i,
            /rbac/i,
            /otp/i,
            /mfa/i,
            /recovery/i,
            /reset.*token/i,
            /csrf/i,
            /cookie/i,
            /production.*security/i,
            /securityMiddleware/i,
        ],
    },
    {
        riskLevel: 'CRITICAL',
        autoExpandLevel: 'level_3_payment_security',
        recommendedCommand: 'npm run test:auth:critical',
        estimatedTests: '500000-1000000+',
        reason: 'Payment-security authentication boundary changed.',
        patterns: [
            /payment/i,
            /checkout/i,
            /saved.*card/i,
            /refund/i,
            /high.*value/i,
            /stripe/i,
            /razorpay/i,
        ],
    },
    {
        riskLevel: 'HIGH',
        autoExpandLevel: 'level_2_risk',
        recommendedCommand: 'npm run test:auth:security',
        estimatedTests: '100000-500000',
        reason: 'Suspicious-login, abuse, fraud, geo-risk, or device-risk logic changed.',
        patterns: [
            /fraud/i,
            /risk/i,
            /abuse/i,
            /suspicious/i,
            /geo/i,
            /rate.*limit/i,
            /distributedRateLimit/i,
            /device.*risk/i,
        ],
    },
    {
        riskLevel: 'HIGH',
        autoExpandLevel: 'level_1_device',
        recommendedCommand: 'npm run test:auth:security',
        estimatedTests: '50000-150000',
        reason: 'Session, browser, cookie, device, or login compatibility surface changed.',
        patterns: [
            /browserSession/i,
            /session/i,
            /trustedDevice/i,
            /device/i,
            /login.*(page|form|view|component)/i,
            /playwright\.config/i,
        ],
    },
    {
        riskLevel: 'HIGH',
        autoExpandLevel: 'level_0_base',
        recommendedCommand: 'npm run test:auth:generated',
        estimatedTests: '5000-20000',
        reason: 'Login API, validation, auth controller, or auth client wrapper changed.',
        patterns: [
            /authController/i,
            /userController/i,
            /authRoutes/i,
            /userRoutes/i,
            /userValidators/i,
            /server\/.*login/i,
            /firebase/i,
            /AuthContext/i,
            /apiClient/i,
        ],
    },
    {
        riskLevel: 'LOW',
        autoExpandLevel: 'level_1_device',
        recommendedCommand: 'npm run test:auth:smoke',
        estimatedTests: '500-2000',
        reason: 'Login UI or browser-facing presentation changed.',
        patterns: [
            /app[\\/].*login/i,
            /app[\\/].*auth/i,
            /\.css$/i,
            /\.scss$/i,
        ],
    },
];

function normalizePath(filePath) {
    return String(filePath || '').replace(/\\/g, '/');
}

function getChangedFilesFromGit(args = []) {
    const filesArg = args.find((arg) => arg.startsWith('--files='));
    if (filesArg) {
        return filesArg.slice('--files='.length).split(',').map((entry) => entry.trim()).filter(Boolean);
    }

    const baseArg = args.find((arg) => arg.startsWith('--base='));
    const headArg = args.find((arg) => arg.startsWith('--head='));
    const base = baseArg ? baseArg.slice('--base='.length) : 'origin/main';
    const head = headArg ? headArg.slice('--head='.length) : 'HEAD';

    const attempts = [
        ['diff', '--name-only', `${base}...${head}`],
        ['diff', '--name-only', `${base}..${head}`],
        ['diff', '--name-only', 'HEAD~1..HEAD'],
        ['diff', '--name-only'],
    ];

    for (const attempt of attempts) {
        try {
            const output = execFileSync('git', attempt, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            const files = output.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
            if (files.length > 0) return files;
        } catch (error) {
            // Try the next strategy.
        }
    }

    return [];
}

function classifyFiles(files = []) {
    const normalizedFiles = files.map(normalizePath);
    if (normalizedFiles.length === 0) {
        const report = buildCountReport('level_0_base');
        return {
            changedFiles: [],
            riskLevel: 'LOW',
            autoExpandLevel: 'level_0_base',
            enabledDimensions: [],
            baseCeiling: report.baseMatrix.logicalCeiling,
            expandedCeiling: report.selectedExpansion.logicalCeiling,
            recommendedCommand: 'npm run test:auth:smoke',
            estimatedTests: '100-500',
            reasons: ['No changed files detected; use the smallest auth smoke tier.'],
        };
    }

    let best = {
        riskLevel: 'LOW',
        autoExpandLevel: 'level_0_base',
        recommendedCommand: 'npm run test:auth:smoke',
        estimatedTests: '100-500',
        reason: 'No auth-sensitive file matched high-risk rules.',
        rank: 0,
    };
    const reasons = [];

    for (const file of normalizedFiles) {
        for (const rule of RULES) {
            if (rule.patterns.some((pattern) => pattern.test(file))) {
                const rank = RISK_ORDER.indexOf(rule.riskLevel);
                reasons.push(`${file}: ${rule.reason}`);
                if (rank > best.rank || (rank === best.rank && rule.autoExpandLevel > best.autoExpandLevel)) {
                    best = { ...rule, rank };
                }
            }
        }
    }

    const report = buildCountReport(best.autoExpandLevel);
    return {
        changedFiles: normalizedFiles,
        riskLevel: best.riskLevel,
        autoExpandLevel: best.autoExpandLevel,
        enabledDimensions: report.selectedExpansion.enabledDimensions,
        baseCeiling: report.baseMatrix.logicalCeiling,
        expandedCeiling: report.selectedExpansion.logicalCeiling,
        recommendedCommand: best.recommendedCommand,
        estimatedTests: best.estimatedTests,
        reasons: reasons.length ? Array.from(new Set(reasons)) : [best.reason],
    };
}

function formatClassification(classification) {
    const lines = [
        `Risk Level: ${classification.riskLevel}`,
        `Auto Expand Level: ${classification.autoExpandLevel}`,
        'Enabled extra dimensions:',
        ...(classification.enabledDimensions.length
            ? classification.enabledDimensions.map((dimension) => `- ${dimension}`)
            : ['- none']),
        '',
        `Base ceiling: ${classification.baseCeiling.toLocaleString('en-US')}`,
        `Expanded ceiling: ${classification.expandedCeiling.toLocaleString('en-US')}`,
        `Recommended execution: ${classification.estimatedTests} risk-selected generated tests`,
        `Recommended command: ${classification.recommendedCommand}`,
        '',
        'Changed files:',
        ...(classification.changedFiles.length
            ? classification.changedFiles.map((file) => `- ${file}`)
            : ['- none']),
        '',
        'Reason:',
        ...classification.reasons.map((reason) => `- ${reason}`),
    ];
    return lines.join('\n');
}

module.exports = {
    RULES,
    classifyFiles,
    formatClassification,
    getChangedFilesFromGit,
};
