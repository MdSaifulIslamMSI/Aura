const { execFile: execFileCallback } = require('child_process');
const { promisify } = require('util');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const {
    SECURITY_AUDIT_EVENTS,
    recordSecurityAuditEvent,
} = require('./securityAuditService');

const execFile = promisify(execFileCallback);

const TARGETS = Object.freeze({
    staging: {
        label: 'Staging',
        defaultTagName: 'aura-staging',
        mutationAllowedEnv: 'AWS_CONTROL_STAGING_MUTATIONS_ENABLED',
    },
    production: {
        label: 'Production',
        defaultTagName: 'aura-backend',
        mutationAllowedEnv: 'AWS_CONTROL_PRODUCTION_MUTATIONS_ENABLED',
    },
});

const ACTIONS = Object.freeze({
    start: 'start-instances',
    stop: 'stop-instances',
});

const REASON_MIN_LENGTH = 8;

const TARGET_BLAST_RADIUS = Object.freeze({
    staging: 'Isolated staging EC2 host, staging API/worker runtime, Redis sidecar, and staging SSM prefix.',
    production: 'Production EC2 host, API container, worker container, Redis sidecar, Caddy edge, public backend traffic, and production SSM prefix.',
});

const REQUIRED_ACTION_GUARDS = Object.freeze([
    'authenticated_session',
    'admin_role',
    'sensitive_action_step_up',
    'server_env_mutation_gate',
    'idempotency_key',
    'operator_reason',
    'exact_confirmation_when_required',
    'security_audit_event',
]);

const RUNBOOKS = Object.freeze([
    {
        key: 'parameter_store_audit',
        label: 'Parameter Store contract audit',
        mode: 'read_only',
        command: 'npm --prefix server run aws:ssm:audit',
    },
    {
        key: 'parameter_store_sync_dry_run',
        label: 'Parameter Store example sync dry run',
        mode: 'dry_run',
        command: 'npm --prefix server run aws:ssm:sync:example',
    },
    {
        key: 'backend_deploy',
        label: 'Backend deploy through GitHub OIDC and SSM Run Command',
        mode: 'ci_controlled',
        command: '.github/workflows/deploy-backend-aws.yml -> infra/aws/deploy-release.sh',
    },
]);

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parsePositiveNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const envString = (env, key, fallback = '') => String(env[key] || fallback).trim();

const toIsoDate = (date) => date.toISOString().slice(0, 10);

const getCurrentMonthWindow = (now = new Date()) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const endCandidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = endCandidate.getTime() <= start.getTime()
        ? new Date(start.getTime() + 24 * 60 * 60 * 1000)
        : endCandidate;

    return {
        start: toIsoDate(start),
        end: toIsoDate(end),
    };
};

const resolveAwsControlConfig = (env = process.env) => {
    const region = envString(env, 'AWS_CONTROL_REGION', envString(env, 'AWS_REGION', 'ap-south-1'));
    const budgetRegion = envString(env, 'AWS_CONTROL_BUDGET_REGION', 'us-east-1');
    const profile = envString(env, 'AWS_CONTROL_AWS_PROFILE');
    const enabled = parseBoolean(env.AWS_CONTROL_ENABLED, false);

    return {
        enabled,
        awsCliPath: envString(env, 'AWS_CONTROL_AWS_CLI', 'aws'),
        region,
        budgetRegion,
        profile,
        timeoutMs: Math.max(parsePositiveNumber(env.AWS_CONTROL_TIMEOUT_MS, 15000), 1000),
        budgetName: envString(env, 'AWS_CONTROL_BUDGET_NAME', 'aura-backend-monthly-guardrail'),
        expirationScheduleName: envString(env, 'AWS_CONTROL_EXPIRATION_SCHEDULE_NAME', 'aura-free-plan-expiration-stop'),
        costEnabled: parseBoolean(env.AWS_CONTROL_COST_ENABLED, true),
        targets: {
            staging: {
                key: 'staging',
                label: TARGETS.staging.label,
                instanceId: envString(env, 'AWS_CONTROL_STAGING_INSTANCE_ID', envString(env, 'STAGING_EC2_INSTANCE_ID')),
                tagName: envString(env, 'AWS_CONTROL_STAGING_INSTANCE_TAG_NAME', TARGETS.staging.defaultTagName),
                mutationsEnabled: enabled && parseBoolean(env[TARGETS.staging.mutationAllowedEnv], false),
            },
            production: {
                key: 'production',
                label: TARGETS.production.label,
                instanceId: envString(env, 'AWS_CONTROL_PRODUCTION_INSTANCE_ID', envString(env, 'AWS_BACKEND_INSTANCE_ID', envString(env, 'INSTANCE_ID'))),
                tagName: envString(env, 'AWS_CONTROL_PRODUCTION_INSTANCE_TAG_NAME', TARGETS.production.defaultTagName),
                mutationsEnabled: enabled && parseBoolean(env[TARGETS.production.mutationAllowedEnv], false),
            },
        },
    };
};

const maskAccountId = (value = '') => {
    const raw = String(value || '').trim();
    if (!/^\d{12}$/.test(raw)) return raw ? '[configured]' : '';
    return `${raw.slice(0, 4)}****${raw.slice(-4)}`;
};

const getActionConfirmationPhrase = (targetKey, action) => {
    const normalizedTarget = String(targetKey || '').trim().toLowerCase();
    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!normalizedTarget) return '';
    if (normalizedAction === 'stop') return `STOP ${normalizedTarget.toUpperCase()}`;
    if (normalizedTarget === 'production' && normalizedAction === 'start') return 'START PRODUCTION';
    return '';
};

const getStopConfirmationPhrase = (targetKey) => getActionConfirmationPhrase(targetKey, 'stop');

const redactAwsError = (value = '') => String(value || '')
    .replace(/\b\d{12}\b/g, (match) => maskAccountId(match))
    .replace(/(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN)=\S+/gi, '$1=[REDACTED]');

const buildTargetOperationPlan = (target = {}, described = {}) => {
    const targetKey = target.key || described.target || '';
    const mutationArmed = Boolean(target.mutationsEnabled);
    const selector = target.instanceId
        ? { type: 'instance_id', value: target.instanceId }
        : { type: 'tag_name', value: target.tagName || '' };
    const targetUniquelyResolved = Boolean(described.instanceId || target.instanceId)
        && !['not_found', 'ambiguous'].includes(String(described.state || '').toLowerCase());

    return {
        target: targetKey,
        blastRadius: TARGET_BLAST_RADIUS[targetKey] || 'Configured AWS target.',
        mutationGateEnv: TARGETS[targetKey]?.mutationAllowedEnv || '',
        credentialBoundary: 'server_aws_cli_only',
        browserReceivesAwsCredentials: false,
        selector,
        requiredGuards: REQUIRED_ACTION_GUARDS,
        actions: Object.keys(ACTIONS).map((action) => {
            const confirmationPhrase = getActionConfirmationPhrase(targetKey, action);
            return {
                action,
                awsApi: `ec2:${ACTIONS[action]}`,
                executionMode: mutationArmed ? 'live_allowlisted' : 'locked_read_only',
                enabled: mutationArmed && targetUniquelyResolved,
                destructive: action === 'stop',
                requiresConfirmationPhrase: Boolean(confirmationPhrase),
                confirmationPhrase,
                reasonMinLength: REASON_MIN_LENGTH,
                idempotencyRequired: true,
            };
        }),
    };
};

const decorateTargetForStatus = (described = {}, target = {}) => ({
    ...described,
    operationPlan: buildTargetOperationPlan(target, described),
});

const buildRiskGates = (config = {}) => ([
    {
        key: 'browser_credentials',
        label: 'Browser AWS credentials',
        state: 'blocked',
        enforced: true,
        detail: 'AWS credentials stay on the backend process or AWS runner; the browser receives sanitized status only.',
    },
    {
        key: 'control_plane_enabled',
        label: 'AWS_CONTROL_ENABLED',
        state: config.enabled ? 'armed' : 'locked',
        enforced: true,
        detail: config.enabled ? 'Live AWS reads are enabled.' : 'Live AWS reads and mutations are disabled.',
    },
    {
        key: 'staging_mutations',
        label: TARGETS.staging.mutationAllowedEnv,
        state: config.targets?.staging?.mutationsEnabled ? 'armed' : 'locked',
        enforced: true,
        detail: 'Staging EC2 start/stop requires this explicit server env opt-in.',
    },
    {
        key: 'production_mutations',
        label: TARGETS.production.mutationAllowedEnv,
        state: config.targets?.production?.mutationsEnabled ? 'armed' : 'locked',
        enforced: true,
        detail: 'Production EC2 start/stop requires a separate server-side break-glass opt-in.',
    },
    {
        key: 'action_allowlist',
        label: 'EC2 action allowlist',
        state: 'enforced',
        enforced: true,
        detail: 'Only ec2:start-instances and ec2:stop-instances are executable through this endpoint.',
    },
]);

const buildParameterStoreSnapshot = (env = process.env) => {
    const pathPrefix = envString(env, 'AWS_PARAMETER_STORE_PATH_PREFIX', envString(env, 'PROD_SSM_PREFIX'));
    return {
        configured: Boolean(pathPrefix),
        pathPrefix,
        storage: 'AWS Systems Manager Parameter Store SecureString',
        secretValuesReturned: false,
        runtimeContractAudit: 'npm --prefix server run aws:ssm:audit',
        dryRunSync: 'npm --prefix server run aws:ssm:sync:example',
        liveSync: 'npm run aws:ssm:sync',
    };
};

const buildDeploymentSnapshot = (config = {}) => ({
    topology: [
        'Vercel frontend',
        'EC2 backend host',
        'API container',
        'worker container',
        'Redis sidecar',
        'Caddy HTTPS edge',
        'optional Ollama sidecar',
    ],
    deployPath: 'GitHub Actions OIDC -> S3 release bundle -> SSM Run Command -> infra/aws/deploy-release.sh',
    region: config.region,
    budgetRegion: config.budgetRegion,
    mutationApis: Object.values(ACTIONS).map((apiAction) => `ec2:${apiAction}`),
    runbooks: RUNBOOKS,
    guardrails: [
        'No browser AWS credentials',
        'No SSH dependency for deploys',
        'Parameter Store prefix scoping',
        'Trusted-device deployment gate',
        'Auth-vault rollout guard',
        'Budget and expiration guardrails',
    ],
});

const buildAwsArgs = (args, config, { region = config.region, output = 'json' } = {}) => {
    const nextArgs = [...args];
    if (region) nextArgs.push('--region', region);
    if (config.profile) nextArgs.push('--profile', config.profile);
    if (output) nextArgs.push('--output', output);
    return nextArgs;
};

const runAws = async (args, {
    config,
    executor = execFile,
    region = config.region,
    output = 'json',
    allowFailure = false,
} = {}) => {
    const fullArgs = buildAwsArgs(args, config, { region, output });

    try {
        const result = await executor(config.awsCliPath, fullArgs, {
            timeout: config.timeoutMs,
            maxBuffer: 1024 * 1024,
        });
        const stdout = typeof result === 'string' ? result : String(result?.stdout || '');
        const stderr = typeof result === 'string' ? '' : String(result?.stderr || '');
        if (!stdout.trim()) return output === 'json' ? null : { stdout, stderr };
        return output === 'json' ? JSON.parse(stdout) : { stdout, stderr };
    } catch (error) {
        const stderr = redactAwsError(error?.stderr || error?.message || 'AWS command failed');
        if (allowFailure) {
            return {
                ok: false,
                reason: stderr,
            };
        }
        const appError = new AppError('AWS control command failed', 502);
        appError.code = 'AWS_CONTROL_COMMAND_FAILED';
        appError.details = { reason: stderr };
        throw appError;
    }
};

const flattenInstances = (describeResult = {}) => (
    Array.isArray(describeResult?.Reservations)
        ? describeResult.Reservations.flatMap((reservation) => reservation.Instances || [])
        : []
);

const tagValue = (instance = {}, key = '') => (
    Array.isArray(instance.Tags)
        ? (instance.Tags.find((tag) => tag.Key === key)?.Value || '')
        : ''
);

const mapInstance = (instance = {}, target = {}) => ({
    target: target.key,
    label: target.label,
    configured: true,
    instanceId: instance.InstanceId || target.instanceId || '',
    state: instance.State?.Name || 'unknown',
    instanceType: instance.InstanceType || '',
    name: tagValue(instance, 'Name') || target.tagName || '',
    environment: tagValue(instance, 'Environment') || target.key,
    costProfile: tagValue(instance, 'CostProfile') || '',
    managedBy: tagValue(instance, 'ManagedBy') || '',
    privateIp: instance.PrivateIpAddress || '',
    publicIp: instance.PublicIpAddress || '',
    launchTime: instance.LaunchTime || '',
    mutationsEnabled: Boolean(target.mutationsEnabled),
    allowedActions: target.mutationsEnabled
        ? ['start', 'stop']
        : [],
});

const describeTargetInstance = async ({ target, config, executor }) => {
    if (target.instanceId) {
        const result = await runAws([
            'ec2',
            'describe-instances',
            '--instance-ids',
            target.instanceId,
        ], { config, executor, allowFailure: true });

        if (result?.ok === false) {
            return {
                target: target.key,
                label: target.label,
                configured: true,
                instanceId: target.instanceId,
                state: 'unknown',
                mutationsEnabled: Boolean(target.mutationsEnabled),
                allowedActions: [],
                warning: result.reason,
            };
        }

        const instance = flattenInstances(result)[0];
        return instance ? mapInstance(instance, target) : {
            target: target.key,
            label: target.label,
            configured: true,
            instanceId: target.instanceId,
            state: 'not_found',
            mutationsEnabled: Boolean(target.mutationsEnabled),
            allowedActions: [],
        };
    }

    if (!target.tagName) {
        return {
            target: target.key,
            label: target.label,
            configured: false,
            reason: 'missing_instance_id_or_tag',
            mutationsEnabled: Boolean(target.mutationsEnabled),
            allowedActions: [],
        };
    }

    const result = await runAws([
        'ec2',
        'describe-instances',
        '--filters',
        `Name=tag:Name,Values=${target.tagName}`,
        'Name=instance-state-name,Values=pending,running,stopping,stopped',
    ], { config, executor, allowFailure: true });

    if (result?.ok === false) {
        return {
            target: target.key,
            label: target.label,
            configured: false,
            state: 'unknown',
            tagName: target.tagName,
            mutationsEnabled: Boolean(target.mutationsEnabled),
            allowedActions: [],
            warning: result.reason,
        };
    }

    const instances = flattenInstances(result);
    if (instances.length !== 1) {
        return {
            target: target.key,
            label: target.label,
            configured: false,
            state: instances.length > 1 ? 'ambiguous' : 'not_found',
            tagName: target.tagName,
            matchingInstances: instances.length,
            mutationsEnabled: Boolean(target.mutationsEnabled),
            allowedActions: [],
        };
    }

    return mapInstance(instances[0], target);
};

const getCallerIdentity = async ({ config, executor }) => {
    const result = await runAws(['sts', 'get-caller-identity'], {
        config,
        executor,
        region: config.budgetRegion,
        allowFailure: true,
    });
    if (result?.ok === false) return { accountMasked: '', arn: '', warning: result.reason };

    return {
        accountMasked: maskAccountId(result?.Account || ''),
        arn: result?.Arn ? String(result.Arn).replace(/\b\d{12}\b/g, (match) => maskAccountId(match)) : '',
        accountId: result?.Account || '',
    };
};

const getCostSnapshot = async ({ config, executor, now }) => {
    if (!config.costEnabled) return { enabled: false, reason: 'cost_disabled' };
    const window = getCurrentMonthWindow(now);
    const result = await runAws([
        'ce',
        'get-cost-and-usage',
        '--time-period',
        `Start=${window.start},End=${window.end}`,
        '--granularity',
        'MONTHLY',
        '--metrics',
        'UnblendedCost',
        '--group-by',
        'Type=DIMENSION,Key=SERVICE',
    ], { config, executor, region: config.budgetRegion, allowFailure: true });

    if (result?.ok === false) {
        return { enabled: true, available: false, warning: result.reason, window };
    }

    const groups = result?.ResultsByTime?.[0]?.Groups || [];
    const services = groups
        .map((group) => ({
            service: group.Keys?.[0] || 'Unknown',
            usd: Number(Number(group.Metrics?.UnblendedCost?.Amount || 0).toFixed(6)),
        }))
        .filter((entry) => entry.usd !== 0)
        .sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd));

    return {
        enabled: true,
        available: true,
        window,
        netUnblendedUsd: Number(Number(result?.ResultsByTime?.[0]?.Total?.UnblendedCost?.Amount || 0).toFixed(6)),
        services,
    };
};

const getGuardrailSnapshot = async ({ config, executor, identity }) => {
    if (!identity?.accountId) {
        return { available: false, warning: 'caller_identity_unavailable' };
    }

    const [budget, actions, schedule] = await Promise.all([
        runAws([
            'budgets',
            'describe-budget',
            '--account-id',
            identity.accountId,
            '--budget-name',
            config.budgetName,
        ], { config, executor, region: config.budgetRegion, allowFailure: true }),
        runAws([
            'budgets',
            'describe-budget-actions-for-budget',
            '--account-id',
            identity.accountId,
            '--budget-name',
            config.budgetName,
        ], { config, executor, region: config.budgetRegion, allowFailure: true }),
        runAws([
            'scheduler',
            'get-schedule',
            '--name',
            config.expirationScheduleName,
        ], { config, executor, allowFailure: true }),
    ]);

    return {
        available: !(budget?.ok === false && actions?.ok === false && schedule?.ok === false),
        budget: budget?.ok === false ? { warning: budget.reason } : {
            name: budget?.Budget?.BudgetName || config.budgetName,
            limitUsd: Number(budget?.Budget?.BudgetLimit?.Amount || 0),
            timeUnit: budget?.Budget?.TimeUnit || '',
        },
        budgetActions: actions?.ok === false ? { warning: actions.reason } : (actions?.Actions || []).map((action) => ({
            actionId: action.ActionId,
            status: action.Status,
            type: action.ActionType,
            subType: action.Definition?.SsmActionDefinition?.ActionSubType || '',
            region: action.Definition?.SsmActionDefinition?.Region || '',
            instanceIds: action.Definition?.SsmActionDefinition?.InstanceIds || [],
            threshold: action.ActionThreshold || {},
        })),
        expirationSchedule: schedule?.ok === false ? { warning: schedule.reason } : {
            name: schedule?.Name || config.expirationScheduleName,
            state: schedule?.State || '',
            scheduleExpression: schedule?.ScheduleExpression || '',
            targetInput: schedule?.Target?.Input || '',
        },
    };
};

const getAwsControlStatus = async ({
    env = process.env,
    executor = execFile,
    now = new Date(),
} = {}) => {
    const config = resolveAwsControlConfig(env);
    const targetList = Object.values(config.targets);
    const statusEnvelope = {
        securityBoundary: {
            credentialBoundary: 'server_aws_cli_only',
            browserReceivesAwsCredentials: false,
            actionRouteGuard: 'protect + admin + sensitiveActions.adminSecurityConfigChange',
            allowedAwsApis: Object.values(ACTIONS).map((apiAction) => `ec2:${apiAction}`),
        },
        riskGates: buildRiskGates(config),
        deployment: buildDeploymentSnapshot(config),
        parameterStore: buildParameterStoreSnapshot(env),
    };

    if (!config.enabled) {
        return {
            enabled: false,
            configured: false,
            reason: 'AWS_CONTROL_ENABLED is not true',
            region: config.region,
            mutationPolicy: {
                staging: false,
                production: false,
            },
            targets: targetList.map((target) => ({
                target: target.key,
                label: target.label,
                configured: Boolean(target.instanceId || target.tagName),
                instanceId: target.instanceId,
                tagName: target.tagName,
                mutationsEnabled: false,
                allowedActions: [],
                operationPlan: buildTargetOperationPlan({ ...target, mutationsEnabled: false }),
            })),
            ...statusEnvelope,
            generatedAt: now.toISOString(),
        };
    }

    const [identity, ...targets] = await Promise.all([
        getCallerIdentity({ config, executor }),
        ...targetList.map((target) => describeTargetInstance({ target, config, executor })),
    ]);
    const [cost, guardrails] = await Promise.all([
        getCostSnapshot({ config, executor, now }),
        getGuardrailSnapshot({ config, executor, identity }),
    ]);

    return {
        enabled: true,
        configured: true,
        region: config.region,
        caller: {
            accountMasked: identity.accountMasked,
            arn: identity.arn,
            warning: identity.warning,
        },
        mutationPolicy: {
            staging: Boolean(config.targets.staging.mutationsEnabled),
            production: Boolean(config.targets.production.mutationsEnabled),
        },
        targets: targets.map((target, index) => decorateTargetForStatus(target, targetList[index])),
        cost,
        guardrails,
        ...statusEnvelope,
        generatedAt: now.toISOString(),
    };
};

const requireEnabledTargetForAction = async ({ targetKey, action, config, executor }) => {
    if (!config.enabled) {
        throw new AppError('AWS control plane is not enabled', 503);
    }
    if (!ACTIONS[action]) {
        throw new AppError('Unsupported AWS control action', 400);
    }
    const target = config.targets[targetKey];
    if (!target) {
        throw new AppError('Unsupported AWS control target', 400);
    }
    if (!target.mutationsEnabled) {
        const error = new AppError(`${target.label} AWS mutations are not enabled`, 403);
        error.code = 'AWS_CONTROL_TARGET_MUTATION_DISABLED';
        throw error;
    }

    const described = await describeTargetInstance({ target, config, executor });
    if (!described?.instanceId || described.configured === false || ['not_found', 'ambiguous'].includes(described.state)) {
        throw new AppError('AWS control target is not uniquely configured', 409);
    }

    return described;
};

const runAwsControlAction = async ({
    target,
    action,
    reason = '',
    confirmationPhrase = '',
    req = null,
    env = process.env,
    executor = execFile,
} = {}) => {
    const config = resolveAwsControlConfig(env);
    const normalizedTarget = String(target || '').trim().toLowerCase();
    const normalizedAction = String(action || '').trim().toLowerCase();
    const normalizedReason = String(reason || '').trim();
    if (normalizedReason.length < REASON_MIN_LENGTH) {
        const error = new AppError('Operator reason is required before changing AWS state', 400);
        error.code = 'AWS_CONTROL_REASON_REQUIRED';
        throw error;
    }
    if (normalizedReason.length > 1000) {
        const error = new AppError('Operator reason is too long', 400);
        error.code = 'AWS_CONTROL_REASON_TOO_LONG';
        throw error;
    }

    const targetInstance = await requireEnabledTargetForAction({
        targetKey: normalizedTarget,
        action: normalizedAction,
        config,
        executor,
    });

    const requiredConfirmationPhrase = getActionConfirmationPhrase(normalizedTarget, normalizedAction);
    if (requiredConfirmationPhrase && String(confirmationPhrase || '').trim() !== requiredConfirmationPhrase) {
        throw new AppError(`Type ${requiredConfirmationPhrase} to ${normalizedAction} the ${normalizedTarget} AWS instance`, 400);
    }

    const apiAction = ACTIONS[normalizedAction];
    const result = await runAws([
        'ec2',
        apiAction,
        '--instance-ids',
        targetInstance.instanceId,
    ], { config, executor });

    recordSecurityAuditEvent({
        event: SECURITY_AUDIT_EVENTS.ADMIN_STATE_CHANGE_ALLOWED,
        req,
        action: `aws.${normalizedTarget}.${normalizedAction}`,
        resourceType: 'aws_ec2_instance',
        resourceId: targetInstance.instanceId,
        result: 'allowed',
        riskLevel: 'critical',
        meta: {
            target: normalizedTarget,
            reason: normalizedReason,
            previousState: targetInstance.state,
            region: config.region,
        },
    });
    logger.warn('aws_control.action_executed', {
        requestId: req?.requestId || '',
        target: normalizedTarget,
        action: normalizedAction,
        instanceId: targetInstance.instanceId,
        previousState: targetInstance.state,
    });

    return {
        target: normalizedTarget,
        action: normalizedAction,
        instanceId: targetInstance.instanceId,
        previousState: targetInstance.state,
        aws: result,
        executedAt: new Date().toISOString(),
    };
};

module.exports = {
    ACTIONS,
    TARGETS,
    getAwsControlStatus,
    getCurrentMonthWindow,
    resolveAwsControlConfig,
    runAwsControlAction,
    __private: {
        buildAwsArgs,
        describeTargetInstance,
        maskAccountId,
        parseBoolean,
        redactAwsError,
        runAws,
        getStopConfirmationPhrase,
        getActionConfirmationPhrase,
        buildRiskGates,
        buildTargetOperationPlan,
        parsePositiveNumber,
    },
};
