import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import AwsControl from './AwsControl';
import { ColorModeProvider } from '@/context/ColorModeContext';
import { adminApi } from '@/services/api';

vi.mock('@/services/api', () => ({
    adminApi: {
        getAwsControl: vi.fn(),
        runAwsControlAction: vi.fn(),
    },
}));

vi.mock('sonner', () => ({
    toast: {
        error: vi.fn(),
        success: vi.fn(),
    },
}));

const buildControlPayload = () => ({
    success: true,
    control: {
        enabled: true,
        configured: true,
        region: 'ap-south-1',
        caller: {
            accountMasked: '1234****9012',
            arn: 'arn:aws:sts::1234****9012:assumed-role/aura-admin/session',
        },
        mutationPolicy: {
            staging: true,
            production: true,
        },
        securityBoundary: {
            credentialBoundary: 'server_aws_cli_only',
            browserReceivesAwsCredentials: false,
            actionRouteGuard: 'protect + admin + sensitiveActions.adminSecurityConfigChange',
            allowedAwsApis: ['ec2:start-instances', 'ec2:stop-instances'],
        },
        riskGates: [
            { key: 'browser_credentials', label: 'Browser AWS credentials', state: 'blocked', enforced: true },
            { key: 'production_mutations', label: 'AWS_CONTROL_PRODUCTION_MUTATIONS_ENABLED', state: 'armed', enforced: true },
            { key: 'action_allowlist', label: 'EC2 action allowlist', state: 'enforced', enforced: true },
        ],
        deployment: {
            topology: ['Vercel frontend', 'EC2 backend host', 'API container'],
            deployPath: 'GitHub Actions OIDC -> S3 release bundle -> SSM Run Command -> infra/aws/deploy-release.sh',
            runbooks: [
                {
                    key: 'parameter_store_audit',
                    label: 'Parameter Store contract audit',
                    mode: 'read_only',
                    command: 'npm --prefix server run aws:ssm:audit',
                },
            ],
        },
        parameterStore: {
            configured: true,
            pathPrefix: '/aura/prod',
            storage: 'AWS Systems Manager Parameter Store SecureString',
            secretValuesReturned: false,
        },
        targets: [
            {
                target: 'staging',
                label: 'Staging',
                configured: true,
                instanceId: 'i-staging',
                state: 'running',
                instanceType: 't3.micro',
                name: 'aura-staging',
                environment: 'staging',
                costProfile: 'free-plan',
                mutationsEnabled: true,
                allowedActions: ['start', 'stop'],
                operationPlan: {
                    target: 'staging',
                    blastRadius: 'Isolated staging EC2 host.',
                    mutationGateEnv: 'AWS_CONTROL_STAGING_MUTATIONS_ENABLED',
                    selector: { type: 'instance_id', value: 'i-staging' },
                    actions: [
                        {
                            action: 'start',
                            awsApi: 'ec2:start-instances',
                            executionMode: 'live_allowlisted',
                            enabled: true,
                            confirmationPhrase: '',
                            requiresConfirmationPhrase: false,
                        },
                        {
                            action: 'stop',
                            awsApi: 'ec2:stop-instances',
                            executionMode: 'live_allowlisted',
                            enabled: true,
                            confirmationPhrase: 'STOP STAGING',
                            requiresConfirmationPhrase: true,
                        },
                    ],
                },
            },
            {
                target: 'production',
                label: 'Production',
                configured: true,
                instanceId: 'i-production',
                state: 'stopped',
                instanceType: 't4g.xlarge',
                name: 'aura-backend',
                environment: 'production',
                costProfile: 'production',
                mutationsEnabled: true,
                allowedActions: ['start', 'stop'],
                operationPlan: {
                    target: 'production',
                    blastRadius: 'Production EC2 host and public backend traffic.',
                    mutationGateEnv: 'AWS_CONTROL_PRODUCTION_MUTATIONS_ENABLED',
                    selector: { type: 'instance_id', value: 'i-production' },
                    actions: [
                        {
                            action: 'start',
                            awsApi: 'ec2:start-instances',
                            executionMode: 'live_allowlisted',
                            enabled: true,
                            confirmationPhrase: 'START PRODUCTION',
                            requiresConfirmationPhrase: true,
                        },
                        {
                            action: 'stop',
                            awsApi: 'ec2:stop-instances',
                            executionMode: 'live_allowlisted',
                            enabled: true,
                            confirmationPhrase: 'STOP PRODUCTION',
                            requiresConfirmationPhrase: true,
                        },
                    ],
                },
            },
        ],
        cost: {
            available: true,
            netUnblendedUsd: 12.34,
            services: [{ service: 'Amazon Elastic Compute Cloud', usd: 12.34 }],
        },
        guardrails: {
            budget: { name: 'aura-backend-monthly-guardrail', limitUsd: 90 },
            budgetActions: [{ actionId: 'budget-action-1', status: 'STANDBY', type: 'RUN_SSM_DOCUMENTS', subType: 'STOP_EC2_INSTANCES' }],
            expirationSchedule: { name: 'aura-free-plan-expiration-stop', state: 'ENABLED', scheduleExpression: 'at(2026-07-31T00:00:00)' },
        },
        generatedAt: '2026-07-04T00:00:00.000Z',
    },
});

const renderAwsControl = () => render(
    <MemoryRouter initialEntries={['/admin/aws-control']}>
        <IntlProvider locale="en">
            <ColorModeProvider>
                <AwsControl />
            </ColorModeProvider>
        </IntlProvider>
    </MemoryRouter>
);

describe('AwsControl', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        adminApi.getAwsControl.mockResolvedValue(buildControlPayload());
        adminApi.runAwsControlAction.mockResolvedValue({ success: true });
    });

    it('renders server-only AWS control boundaries and live operation plans', async () => {
        renderAwsControl();

        expect(await screen.findByText('AWS identity and boundary')).toBeInTheDocument();
        expect(screen.getByText('Browser credentials blocked')).toBeInTheDocument();
        expect(screen.getAllByText('AWS_CONTROL_PRODUCTION_MUTATIONS_ENABLED').length).toBeGreaterThan(0);
        expect(screen.getAllByText('ec2:start-instances').length).toBeGreaterThan(0);
        expect(screen.getAllByText(/START PRODUCTION/).length).toBeGreaterThan(0);
        expect(screen.getByText(/GitHub Actions OIDC/)).toBeInTheDocument();
        expect(screen.getByText('Prefix /aura/prod')).toBeInTheDocument();
        expect(screen.getByText('Budget actions')).toBeInTheDocument();
    });

    it('requires the production start confirmation phrase before calling the action API', async () => {
        renderAwsControl();

        await screen.findByText('AWS identity and boundary');
        fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'production' } });
        fireEvent.change(screen.getByLabelText('Operator reason'), {
            target: { value: 'operator requested production start' },
        });

        fireEvent.click(screen.getByRole('button', { name: /start production/i }));

        expect(adminApi.runAwsControlAction).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith('Type START PRODUCTION before running this AWS action');

        fireEvent.change(screen.getByLabelText('Stop confirmation'), {
            target: { value: 'START PRODUCTION' },
        });
        fireEvent.click(screen.getByRole('button', { name: /start production/i }));

        await waitFor(() => {
            expect(adminApi.runAwsControlAction).toHaveBeenCalledWith(expect.objectContaining({
                target: 'production',
                action: 'start',
                confirmationPhrase: 'START PRODUCTION',
            }));
        });
    });
});
