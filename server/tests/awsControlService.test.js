const {
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
        });
        expect(executor).not.toHaveBeenCalled();
    });

    test('keeps production mutations disabled even when the env tries to enable them', () => {
        const config = resolveAwsControlConfig({
            AWS_CONTROL_ENABLED: 'true',
            AWS_CONTROL_PRODUCTION_MUTATIONS_ENABLED: 'true',
            AWS_CONTROL_STAGING_MUTATIONS_ENABLED: 'true',
            AWS_CONTROL_TIMEOUT_MS: 'not-a-number',
        });

        expect(config.targets.staging.mutationsEnabled).toBe(true);
        expect(config.targets.production.mutationsEnabled).toBe(false);
        expect(config.timeoutMs).toBe(15000);
    });

    test('rejects production start and stop actions', async () => {
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
            code: 'AWS_CONTROL_PRODUCTION_MUTATION_DISABLED',
        });
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
});
