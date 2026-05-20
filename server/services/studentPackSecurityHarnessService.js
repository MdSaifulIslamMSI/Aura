const { existsSync, readFileSync } = require('fs');
const { join, resolve } = require('path');
const fetch = require('node-fetch');

const DEFAULT_LOCALSTACK_HEALTH_URL = 'http://127.0.0.1:4566/_localstack/health';
const repoRoot = resolve(__dirname, '..', '..');
const LIVE_AUTH_REPORT_PATH = join(repoRoot, '.run-logs', 'student-pack-live-auth.json');

const toBool = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const hasEnv = (key) => String(process.env[key] || '').trim().length > 0;

const envGroupState = (keys = []) => {
    const configuredKeys = keys.filter(hasEnv);
    return {
        keys,
        ready: configuredKeys.length === keys.length,
        configuredKeys,
        missingKeys: keys.filter((key) => !configuredKeys.includes(key)),
    };
};

const checkStatusFromGroups = (groups = []) => {
    if (!groups.length) return 'ready';
    if (groups.some((group) => group.ready)) return 'ready';
    if (groups.some((group) => group.configuredKeys.length > 0)) return 'partial';
    return 'blocked';
};

const statusWeight = (status) => {
    switch (status) {
        case 'ready':
            return 1;
        case 'partial':
            return 0.5;
        case 'maintenance':
            return 0.75;
        default:
            return 0;
    }
};

const providerStatusFromChecks = (checks = []) => {
    if (!checks.length) return 'blocked';
    if (checks.every((check) => check.status === 'ready' || check.status === 'maintenance')) return 'ready';
    if (checks.some((check) => ['ready', 'partial', 'maintenance'].includes(check.status))) return 'partial';
    return 'blocked';
};

const unique = (items = []) => [...new Set(items.filter(Boolean))];

const SECURITY_HARNESS_PROVIDERS = [
    {
        id: 'doppler',
        name: 'Doppler',
        area: 'Secrets',
        summary: 'Injects provider credentials into local backend, frontend, and CI commands.',
        checks: [
            {
                id: 'secret-source',
                label: 'Secret source configured',
                envGroups: [['DOPPLER_TOKEN'], ['DOPPLER_PROJECT', 'DOPPLER_CONFIG']],
                detail: 'Use Doppler token mode or project/config mode.',
            },
        ],
        commands: ['doppler run -- npm run student-pack:start', 'npm run student-pack:doctor'],
    },
    {
        id: 'sentry',
        name: 'Sentry',
        area: 'Runtime errors',
        summary: 'Catches application exceptions and protects releases with sourcemap-ready release metadata.',
        checks: [
            {
                id: 'runtime-capture',
                label: 'Runtime error capture',
                envGroups: [['SENTRY_DSN']],
                detail: 'DSN enables runtime exception reporting.',
            },
            {
                id: 'release-automation',
                label: 'Release automation',
                envGroups: [['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT']],
                detail: 'Auth, org, and project enable release creation.',
            },
        ],
        commands: ['npm run student-pack:sentry:release'],
    },
    {
        id: 'datadog',
        name: 'Datadog',
        area: 'Observability',
        summary: 'Uploads CI signals and gives the harness an external operations telemetry path.',
        checks: [
            {
                id: 'api-key',
                label: 'CI visibility API key',
                envGroups: [['DATADOG_API_KEY'], ['DD_API_KEY']],
                detail: 'Either Datadog API key variable is accepted.',
            },
        ],
        commands: ['npm run student-pack:datadog:doctor', 'npm run student-pack:datadog:junit -- test-results'],
    },
    {
        id: 'testmail',
        name: 'Testmail',
        area: 'Email security tests',
        summary: 'Verifies OTP, auth, order, and status email flows against disposable inboxes.',
        checks: [
            {
                id: 'mailbox-api',
                label: 'Inbox API access',
                envGroups: [['TESTMAIL_APIKEY', 'TESTMAIL_NAMESPACE']],
                detail: 'API key and namespace are required to query inboxes.',
            },
        ],
        commands: ['npm run student-pack:testmail'],
    },
    {
        id: 'lambdatest',
        name: 'LambdaTest',
        area: 'Cross-browser security',
        summary: 'Runs sensitive login, checkout, status, and admin flows through real browser matrices.',
        checks: [
            {
                id: 'tunnel-identity',
                label: 'Tunnel credentials',
                envGroups: [['LT_USERNAME', 'LT_ACCESS_KEY'], ['LT_USERNAME', 'LAMBDATEST_ACCESS_KEY']],
                detail: 'Username plus access key enable the local tunnel.',
            },
        ],
        commands: ['npm run student-pack:lambdatest:tunnel'],
    },
    {
        id: 'localstack',
        name: 'LocalStack',
        area: 'AWS sandbox',
        summary: 'Exercises S3, SSM, and cloud-adjacent security flows without touching production AWS.',
        checks: [
            {
                id: 'auth-token',
                label: 'LocalStack activation token',
                envGroups: [['LOCALSTACK_AUTH_TOKEN'], ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']],
                detail: 'Token starts current LocalStack builds; AWS test keys support local resources.',
            },
        ],
        commands: ['npm run student-pack:start', 'awslocal s3 ls'],
    },
];

const SECURITY_HARNESS_CONTROLS = [
    {
        id: 'secret-boundary',
        name: 'Secret boundary',
        category: 'Config safety',
        providerIds: ['doppler'],
        purpose: 'Keeps provider credentials out of source, browser bundles, logs, and committed env files.',
        gatedFlows: ['local_start', 'ci_release', 'provider_smoke'],
    },
    {
        id: 'release-error-loop',
        name: 'Release error loop',
        category: 'Runtime protection',
        providerIds: ['sentry', 'datadog'],
        purpose: 'Connects deploy metadata, JavaScript exceptions, server failures, and test evidence into one rollback signal.',
        gatedFlows: ['frontend_release', 'backend_release', 'desktop_release'],
    },
    {
        id: 'email-auth-harness',
        name: 'Email and OTP harness',
        category: 'Auth assurance',
        providerIds: ['testmail', 'sentry', 'datadog'],
        purpose: 'Exercises signup, OTP, recovery, order, and status emails with traceable failures.',
        gatedFlows: ['signup_otp', 'passwordless_login', 'order_email', 'status_subscription'],
    },
    {
        id: 'browser-matrix',
        name: 'Browser security matrix',
        category: 'Cross-browser QA',
        providerIds: ['lambdatest', 'datadog', 'sentry'],
        purpose: 'Runs sensitive auth, checkout, admin, and status flows through remote browsers with failure telemetry.',
        gatedFlows: ['login_matrix', 'checkout_matrix', 'admin_matrix', 'status_page_matrix'],
    },
    {
        id: 'aws-sandbox',
        name: 'AWS sandbox isolation',
        category: 'Cloud safety',
        providerIds: ['localstack', 'doppler'],
        purpose: 'Verifies S3, SSM, and upload paths locally before any AWS-backed deployment path is touched.',
        gatedFlows: ['review_uploads', 'parameter_store_sync', 'cloud_smoke'],
    },
    {
        id: 'full-incident-drill',
        name: 'Full incident drill',
        category: 'Operational readiness',
        providerIds: ['sentry', 'datadog', 'testmail', 'lambdatest', 'localstack', 'doppler'],
        purpose: 'Combines error capture, telemetry, email proof, browser proof, sandboxed cloud dependencies, and secret injection.',
        gatedFlows: ['pre_merge_gate', 'release_candidate_gate', 'production_readiness_review'],
    },
];

const SECURITY_HARNESS_GATED_FLOWS = [
    {
        id: 'auth-critical',
        name: 'Auth critical path',
        providerIds: ['doppler', 'testmail', 'lambdatest', 'sentry', 'datadog'],
        command: 'npm run security:auth',
    },
    {
        id: 'checkout-critical',
        name: 'Checkout and payment safety',
        providerIds: ['doppler', 'lambdatest', 'sentry', 'datadog'],
        command: 'npm run test:server:regression',
    },
    {
        id: 'upload-cloud-sandbox',
        name: 'Upload and cloud sandbox',
        providerIds: ['doppler', 'localstack', 'sentry', 'datadog'],
        command: 'npm run student-pack:start',
    },
    {
        id: 'status-incident-loop',
        name: 'Status incident loop',
        providerIds: ['testmail', 'sentry', 'datadog'],
        command: 'npm --prefix server test -- --runTestsByPath tests/statusService.test.js tests/statusRoutes.test.js',
    },
    {
        id: 'release-observability',
        name: 'Release observability',
        providerIds: ['doppler', 'sentry', 'datadog', 'lambdatest'],
        command: 'npm run student-pack:auth:live',
    },
];

const evaluateEnvCheck = (check) => {
    const groups = (check.envGroups || []).map(envGroupState);
    const status = checkStatusFromGroups(groups);
    return {
        id: check.id,
        label: check.label,
        detail: check.detail,
        status,
        envGroups: groups,
        missingEnv: unique(groups.flatMap((group) => group.missingKeys)),
        configuredEnv: unique(groups.flatMap((group) => group.configuredKeys)),
    };
};

const combinedStatus = (providerIds = [], providerMap = new Map()) => {
    const statuses = providerIds.map((id) => providerMap.get(id)?.status || 'blocked');
    if (statuses.every((status) => status === 'ready')) return 'ready';
    if (statuses.some((status) => status === 'ready' || status === 'partial')) return 'partial';
    return 'blocked';
};

const readinessFromProviderIds = (providerIds = [], providerMap = new Map()) => {
    if (!providerIds.length) return 0;
    const total = providerIds.reduce((sum, id) => sum + statusWeight(providerMap.get(id)?.status || 'blocked'), 0);
    return Math.round((total / providerIds.length) * 100);
};

const missingEnvForProviderIds = (providerIds = [], providerMap = new Map()) => unique(
    providerIds.flatMap((id) => providerMap.get(id)?.missingEnv || [])
);

const buildControlMatrix = (providers = []) => {
    const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
    return SECURITY_HARNESS_CONTROLS.map((control) => ({
        ...control,
        status: combinedStatus(control.providerIds, providerMap),
        readinessPercent: readinessFromProviderIds(control.providerIds, providerMap),
        missingEnv: missingEnvForProviderIds(control.providerIds, providerMap),
    }));
};

const buildGatedFlows = (providers = []) => {
    const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
    return SECURITY_HARNESS_GATED_FLOWS.map((flow) => ({
        ...flow,
        status: combinedStatus(flow.providerIds, providerMap),
        readinessPercent: readinessFromProviderIds(flow.providerIds, providerMap),
        missingEnv: missingEnvForProviderIds(flow.providerIds, providerMap),
    }));
};

const buildNextActions = ({ providers = [], controls = [], gatedFlows = [] } = {}) => {
    const unlockActions = providers
        .filter((provider) => provider.status !== 'ready')
        .map((provider) => ({
            id: `unlock-${provider.id}`,
            title: `Unlock ${provider.name}`,
            providerId: provider.id,
            status: provider.status,
            missingEnv: provider.missingEnv.slice(0, 6),
            command: provider.commands[0] || 'npm run student-pack:doctor',
        }));

    const readyFlowActions = gatedFlows
        .filter((flow) => flow.status === 'ready')
        .slice(0, 3)
        .map((flow) => ({
            id: `run-${flow.id}`,
            title: `Ready gate: ${flow.name}`,
            providerId: '',
            status: 'ready',
            missingEnv: [],
            command: flow.command,
        }));

    const hardeningActions = controls
        .filter((control) => control.status === 'partial')
        .slice(0, 2)
        .map((control) => ({
            id: `harden-${control.id}`,
            title: `Harden ${control.name}`,
            providerId: '',
            status: 'partial',
            missingEnv: control.missingEnv.slice(0, 6),
            command: 'npm run student-pack:auth:live',
        }));

    return [...unlockActions, ...readyFlowActions, ...hardeningActions].slice(0, 8);
};

const readLiveAuthReport = () => {
    const reportPath = String(process.env.STUDENT_PACK_LIVE_AUTH_REPORT_PATH || LIVE_AUTH_REPORT_PATH);
    if (!existsSync(reportPath)) {
        return { generatedAt: null, results: [] };
    }
    try {
        const parsed = JSON.parse(readFileSync(reportPath, 'utf8'));
        return {
            generatedAt: parsed.generatedAt || null,
            results: Array.isArray(parsed.results)
                ? parsed.results.map((result) => ({
                    id: String(result.id || ''),
                    name: String(result.name || ''),
                    status: ['ready', 'partial', 'blocked'].includes(result.status) ? result.status : 'blocked',
                    detail: String(result.detail || '').slice(0, 240),
                    command: String(result.command || '').slice(0, 240),
                })).filter((result) => result.id)
                : [],
        };
    } catch {
        return { generatedAt: null, results: [] };
    }
};

const applyLiveAuthResult = (provider, liveResult) => {
    if (!liveResult) return provider;
    const status = liveResult.status === 'ready'
        ? 'ready'
        : liveResult.status || provider.status;
    return {
        ...provider,
        status,
        readinessPercent: status === 'ready' ? 100 : status === 'partial' ? Math.min(provider.readinessPercent, 50) : 0,
        liveAuth: {
            status,
            detail: liveResult.detail,
            command: liveResult.command,
        },
    };
};

const probeLocalStack = async ({ timeoutMs = 1200 } = {}) => {
    const url = String(process.env.LOCALSTACK_HEALTH_URL || DEFAULT_LOCALSTACK_HEALTH_URL).trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            return { ready: false, detail: `HTTP ${response.status}`, url };
        }
        const body = await response.json().catch(() => ({}));
        const services = Object.keys(body.services || {});
        return {
            ready: true,
            detail: services.length ? `${services.length} services reported` : 'endpoint healthy',
            url,
        };
    } catch (error) {
        return {
            ready: false,
            detail: error.name === 'AbortError' ? 'timeout' : 'not reachable',
            url,
        };
    } finally {
        clearTimeout(timer);
    }
};

const evaluateProvider = async (definition, { probeEndpoints = true } = {}) => {
    const checks = definition.checks.map(evaluateEnvCheck);

    if (definition.id === 'localstack') {
        const endpoint = probeEndpoints
            ? await probeLocalStack()
            : { ready: false, detail: 'endpoint probe skipped', url: String(process.env.LOCALSTACK_HEALTH_URL || DEFAULT_LOCALSTACK_HEALTH_URL) };
        checks.push({
            id: 'local-endpoint',
            label: 'Local AWS endpoint',
            detail: endpoint.detail,
            status: endpoint.ready ? 'ready' : hasEnv('LOCALSTACK_AUTH_TOKEN') ? 'partial' : 'blocked',
            envGroups: [],
            missingEnv: endpoint.ready ? [] : ['LOCALSTACK_AUTH_TOKEN'],
            configuredEnv: hasEnv('LOCALSTACK_AUTH_TOKEN') ? ['LOCALSTACK_AUTH_TOKEN'] : [],
            endpointUrl: endpoint.url,
        });
    }

    const status = providerStatusFromChecks(checks);
    return {
        id: definition.id,
        name: definition.name,
        area: definition.area,
        summary: definition.summary,
        status,
        readinessPercent: Math.round((checks.reduce((sum, check) => sum + statusWeight(check.status), 0) / checks.length) * 100),
        missingEnv: unique(checks.flatMap((check) => check.missingEnv)),
        configuredEnv: unique(checks.flatMap((check) => check.configuredEnv)),
        checks,
        commands: definition.commands,
    };
};

const getStudentPackSecurityHarnessSnapshot = async ({ probeEndpoints = true } = {}) => {
    const liveAuth = readLiveAuthReport();
    const liveAuthByProvider = new Map(liveAuth.results.map((result) => [result.id, result]));
    const providers = [];
    for (const provider of SECURITY_HARNESS_PROVIDERS) {
        const evaluated = await evaluateProvider(provider, { probeEndpoints });
        providers.push(applyLiveAuthResult(evaluated, liveAuthByProvider.get(evaluated.id)));
    }
    const readinessPercent = Math.round(
        (providers.reduce((sum, provider) => sum + statusWeight(provider.status), 0) / providers.length) * 100
    );
    const blockedProviders = providers.filter((provider) => provider.status === 'blocked');
    const partialProviders = providers.filter((provider) => provider.status === 'partial');
    const controls = buildControlMatrix(providers);
    const gatedFlows = buildGatedFlows(providers);
    const overallStatus = blockedProviders.length === 0 && partialProviders.length === 0
        ? 'operational'
        : readinessPercent >= 67
            ? 'degraded_performance'
            : readinessPercent >= 34
                ? 'partial_outage'
                : 'major_outage';

    return {
        enabled: true,
        overallStatus,
        readinessPercent,
        readyProviders: providers.filter((provider) => provider.status === 'ready').length,
        partialProviders: partialProviders.length,
        blockedProviders: blockedProviders.length,
        providers,
        controls,
        gatedFlows,
        nextActions: buildNextActions({ providers, controls, gatedFlows }),
        liveAuth: {
            generatedAt: liveAuth.generatedAt,
            available: liveAuth.results.length > 0,
        },
        missingEnv: unique(providers.flatMap((provider) => provider.missingEnv)),
        updatedAt: new Date().toISOString(),
    };
};

const isStudentPackSecurityHarnessEnabled = () => toBool(
    process.env.STUDENT_PACK_SECURITY_HARNESS_ENABLED,
    process.env.NODE_ENV === 'development'
);

const shouldExposeStudentPackSecurityHarness = () => {
    if (!isStudentPackSecurityHarnessEnabled()) return false;
    return toBool(
        process.env.STUDENT_PACK_SECURITY_HARNESS_PUBLIC,
        process.env.NODE_ENV !== 'production'
    );
};

module.exports = {
    DEFAULT_LOCALSTACK_HEALTH_URL,
    SECURITY_HARNESS_CONTROLS,
    SECURITY_HARNESS_GATED_FLOWS,
    SECURITY_HARNESS_PROVIDERS,
    LIVE_AUTH_REPORT_PATH,
    getStudentPackSecurityHarnessSnapshot,
    isStudentPackSecurityHarnessEnabled,
    shouldExposeStudentPackSecurityHarness,
    __testables: {
        buildControlMatrix,
        buildGatedFlows,
        evaluateEnvCheck,
        evaluateProvider,
        readLiveAuthReport,
        probeLocalStack,
        toBool,
    },
};
