const {
    __private,
    getAwsControlStatus,
    resolveAwsControlConfig,
    runAwsControlAction,
} = require('../services/awsControlService');

const json = (value) => ({ stdout: JSON.stringify(value), stderr: '' });

const buildDescribeInstance = ({
    instanceId = 'i-staging',
    name = 'aura-staging',
    state = 'running',
    environment = 'staging',
} = {}) => ({
    Reservations: [
        {
            Instances: [
                {
                    InstanceId: instanceId,
                    InstanceType: 't3.micro',
                    State: { Name: state },
                    PrivateIpAddress: '172.31.0.10',
                    PublicIpAddress: '203.0.113.10',
                    LaunchTime: '2026-07-01T00:00:00.000Z',
                    Tags: [
                        { Key: 'Name', Value: name },
                        { Key: 'Environment', Value: environment },
                        { Key: 'CostProfile', Value: 'free-plan' },
                        { Key: 'ManagedBy', Value: 'codex-test' },
                    ],
                },
            ],
        },
    ],
});

describe('awsControlService', () => {
    test('is disabled by default and does not execute AWS commands', async () => {
        const executor = jest.fn();

        const status = await getAwsControlStatus({
            env: {},
            executor,
            now: new Date('2026-07-04T00:00:00Z'),
        });

        expect(status).toMatchObject({
            enabled: false,
            configured: false,
            mutationPolicy: {
                staging: false,
                production: false,
            },
            securityBoundary: {
                credentialBoundary: 'server_aws_cli_only',
                browserReceivesAwsCredentials: false,
            },
            parameterStore: {
                secretValuesReturned: false,
            },
        });
        expect(status.targets[0].operationPlan.actions).toEqual(expect.arrayContaining([
            expect.objectContaining({
                awsApi: 'ec2:start-instances',
                executionMode: 'locked_read_only',
                enabled: false,
            }),
            expect.objectContaining({
                awsApi: 'ec2:stop-instances',
                confirmationPhrase: 'STOP STAGING',
                enabled: false,
            }),
        ]));
        expect(status.riskGates).toEqual(expect.arrayContaining([
            expect.objectContaining({
                key: 'browser_credentials',
                state: 'blocked',
                enforced: true,
            }),
            expect.objectContaining({
                key: 'action_allowlist',
                state: 'enforced',
            }),
        ]));
        expect(executor).not.toHaveBeenCalled();
    });

    test('requires explicit env opt-in before production mutations are enabled', () => {
        const config = resolveAwsControlConfig({
            AWS_CONTROL_ENABLED: 'true',
            AWS_CONTROL_STAGING_MUTATIONS_ENABLED: 'true',
            AWS_CONTROL_TIMEOUT_MS: 'not-a-number',
        });

        expect(config.targets.staging.mutationsEnabled).toBe(true);
        expect(config.targets.production.mutationsEnabled).toBe(false);
        expect(config.timeoutMs).toBe(15000);
    });

    test('exposes production actions only after explicit env opt-in', async () => {
        const config = resolveAwsControlConfig({
            AWS_CONTROL_ENABLED: 'true',
            AWS_CONTROL_PRODUCTION_MUTATIONS_ENABLED: 'true',
            AWS_CONTROL_PRODUCTION_INSTANCE_ID: 'i-production',
        });

        expect(config.targets.production.mutationsEnabled).toBe(true);
    });

    test('maps explicitly enabled production target as actionable in status payloads', async () => {
        const config = resolveAwsControlConfig({
            AWS_CONTROL_ENABLED: 'true',
            AWS_CONTROL_PRODUCTION_MUTATIONS_ENABLED: 'true',
            AWS_CONTROL_PRODUCTION_INSTANCE_ID: 'i-production',
        });
        const executor = jest.fn(async () => json(buildDescribeInstance({
            instanceId: 'i-production',
            name: 'aura-backend',
            environment: 'production',
        })));

        const described = await __private.describeTargetInstance({
            target: config.targets.production,
            config,
            executor,
        });

        expect(described).toMatchObject({
            target: 'production',
            mutationsEnabled: true,
            allowedActions: ['start', 'stop'],
        });
    });

    test('rejects production actions when the production env gate is not enabled', async () => {
        await expect(runAwsControlAction({
            target: 'production',
            action: 'stop',
            reason: 'operator requested production stop',
            confirmationPhrase: 'STOP PRODUCTION',
            env: {
                AWS_CONTROL_ENABLED: 'true',
                AWS_CONTROL_STAGING_MUTATIONS_ENABLED: 'true',
                AWS_CONTROL_PRODUCTION_INSTANCE_ID: 'i-production',
            },
            executor: jest.fn(),
        })).rejects.toMatchObject({
            statusCode: 403,
            code: 'AWS_CONTROL_TARGET_MUTATION_DISABLED',
        });
    });

    test('requires an operator reason before any AWS mutation is described', async () => {
        const executor = jest.fn();

        await expect(runAwsControlAction({
            target: 'staging',
            action: 'start',
            reason: '   ',
            env: {
                AWS_CONTROL_ENABLED: 'true',
                AWS_CONTROL_STAGING_MUTATIONS_ENABLED: 'true',
                AWS_CONTROL_STAGING_INSTANCE_ID: 'i-staging',
            },
            executor,
        })).rejects.toMatchObject({
            statusCode: 400,
            code: 'AWS_CONTROL_REASON_REQUIRED',
        });

        expect(executor).not.toHaveBeenCalled();
    });

    test('requires START PRODUCTION confirmation before starting production', async () => {
        const executor = jest.fn(async (_command, args) => {
            if (args.includes('describe-instances')) {
                return json(buildDescribeInstance({
                    instanceId: 'i-production',
                    name: 'aura-backend',
                    state: 'stopped',
                    environment: 'production',
                }));
            }
            return json({});
        });

        await expect(runAwsControlAction({
            target: 'production',
            action: 'start',
            reason: 'operator requested production start',
            confirmationPhrase: '',
            env: {
                AWS_CONTROL_ENABLED: 'true',
                AWS_CONTROL_PRODUCTION_MUTATIONS_ENABLED: 'true',
                AWS_CONTROL_PRODUCTION_INSTANCE_ID: 'i-production',
            },
            executor,
        })).rejects.toMatchObject({
            statusCode: 400,
        });

        expect(executor).toHaveBeenCalledTimes(1);
    });

    test('requires STOP STAGING confirmation before stopping staging', async () => {
        const executor = jest.fn(async (_command, args) => {
            if (args.includes('describe-instances')) {
                return json(buildDescribeInstance({ instanceId: 'i-staging' }));
            }
            return json({});
        });

        await expect(runAwsControlAction({
            target: 'staging',
            action: 'stop',
            reason: 'operator requested staging stop',
            confirmationPhrase: 'wrong phrase',
            env: {
                AWS_CONTROL_ENABLED: 'true',
                AWS_CONTROL_STAGING_MUTATIONS_ENABLED: 'true',
                AWS_CONTROL_STAGING_INSTANCE_ID: 'i-staging',
            },
            executor,
        })).rejects.toMatchObject({
            statusCode: 400,
        });

        expect(executor).toHaveBeenCalledTimes(1);
    });

    test('executes an allowlisted staging stop through EC2 only', async () => {
        const executor = jest.fn(async (_command, args) => {
            if (args.includes('describe-instances')) {
                return json(buildDescribeInstance({ instanceId: 'i-staging' }));
            }
            if (args.includes('stop-instances')) {
                return json({
                    StoppingInstances: [
                        {
                            InstanceId: 'i-staging',
                            CurrentState: { Name: 'stopping' },
                            PreviousState: { Name: 'running' },
                        },
                    ],
                });
            }
            throw new Error(`Unexpected AWS args: ${args.join(' ')}`);
        });

        const result = await runAwsControlAction({
            target: 'staging',
            action: 'stop',
            reason: 'operator requested staging stop',
            confirmationPhrase: 'STOP STAGING',
            env: {
                AWS_CONTROL_ENABLED: 'true',
                AWS_CONTROL_STAGING_MUTATIONS_ENABLED: 'true',
                AWS_CONTROL_STAGING_INSTANCE_ID: 'i-staging',
                AWS_CONTROL_REGION: 'ap-south-1',
            },
            executor,
        });

        expect(result).toMatchObject({
            target: 'staging',
            action: 'stop',
            instanceId: 'i-staging',
            previousState: 'running',
        });
        expect(executor).toHaveBeenCalledWith(
            'aws',
            expect.arrayContaining(['ec2', 'stop-instances', '--instance-ids', 'i-staging', '--region', 'ap-south-1']),
            expect.any(Object),
        );
    });

    test('requires STOP PRODUCTION confirmation before stopping production', async () => {
        const executor = jest.fn(async (_command, args) => {
            if (args.includes('describe-instances')) {
                return json(buildDescribeInstance({
                    instanceId: 'i-production',
                    name: 'aura-backend',
                    environment: 'production',
                }));
            }
            return json({});
        });

        await expect(runAwsControlAction({
            target: 'production',
            action: 'stop',
            reason: 'operator requested production stop',
            confirmationPhrase: 'STOP STAGING',
            env: {
                AWS_CONTROL_ENABLED: 'true',
                AWS_CONTROL_PRODUCTION_MUTATIONS_ENABLED: 'true',
                AWS_CONTROL_PRODUCTION_INSTANCE_ID: 'i-production',
            },
            executor,
        })).rejects.toMatchObject({
            statusCode: 400,
        });

        expect(executor).toHaveBeenCalledTimes(1);
    });

    test('executes an explicitly enabled production start through EC2 only', async () => {
        const executor = jest.fn(async (_command, args) => {
            if (args.includes('describe-instances')) {
                return json(buildDescribeInstance({
                    instanceId: 'i-production',
                    name: 'aura-backend',
                    state: 'stopped',
                    environment: 'production',
                }));
            }
            if (args.includes('start-instances')) {
                return json({
                    StartingInstances: [
                        {
                            InstanceId: 'i-production',
                            CurrentState: { Name: 'pending' },
                            PreviousState: { Name: 'stopped' },
                        },
                    ],
                });
            }
            throw new Error(`Unexpected AWS args: ${args.join(' ')}`);
        });

        const result = await runAwsControlAction({
            target: 'production',
            action: 'start',
            reason: 'operator requested production start',
            confirmationPhrase: 'START PRODUCTION',
            env: {
                AWS_CONTROL_ENABLED: 'true',
                AWS_CONTROL_PRODUCTION_MUTATIONS_ENABLED: 'true',
                AWS_CONTROL_PRODUCTION_INSTANCE_ID: 'i-production',
                AWS_CONTROL_REGION: 'ap-south-1',
            },
            executor,
        });

        expect(result).toMatchObject({
            target: 'production',
            action: 'start',
            instanceId: 'i-production',
            previousState: 'stopped',
        });
        expect(executor).toHaveBeenCalledWith(
            'aws',
            expect.arrayContaining(['ec2', 'start-instances', '--instance-ids', 'i-production', '--region', 'ap-south-1']),
            expect.any(Object),
        );
    });
});
