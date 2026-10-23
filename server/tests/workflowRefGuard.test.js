const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');

const read = (...segments) => fs.readFileSync(path.join(...segments), 'utf8');

describe('privileged workflow ref guards', () => {
    const guardedWorkflows = [
        'deploy-backend-aws.yml',
        'production-db-maintenance.yml',
        'staging-aws-deploy.yml',
        'production-admin-access.yml',
    ];

    test.each(guardedWorkflows)('%s only deploys commits reachable from main', (workflowName) => {
        const workflow = read(WORKFLOWS_DIR, workflowName);

        expect(workflow).toContain('ref-guard:');
        expect(workflow).toContain('git merge-base --is-ancestor');
        expect(workflow).toContain("ref: ${{ needs.ref-guard.outputs.release_sha }}");
        expect(workflow).not.toContain("ref: ${{ inputs.git_ref }}");
    });

    test('deploy preflight consumes the guarded immutable SHA', () => {
        const workflow = read(WORKFLOWS_DIR, 'deploy-backend-aws.yml');

        expect(workflow).toContain('release_sha: ${{ needs.ref-guard.outputs.release_sha }}');
        expect(workflow).toContain('GUARDED_RELEASE_SHA');
    });
});

describe('staging IAM tag conditions cannot be bypassed by missing tags', () => {
    test('destructive EC2 and SSM actions require an Environment tag', () => {
        const policy = read(REPO_ROOT, 'scripts', 'staging', '00-create-iam-auth.sh');

        expect(policy).not.toContain('StringEqualsIfExists');
        expect(policy).toContain('RunStagingInstanceCommandsTaggedInstances');
        expect(policy).toContain('ManageExistingStagingEc2Resources');
        expect(policy).toContain('TagStagingEc2ResourcesAtCreate');
        expect(policy).toContain('ec2:CreateAction');
        expect(policy).toContain('"aws:ResourceTag/Environment": "staging"');
        expect(policy).toContain('"aws:RequestTag/Environment": "staging"');
    });

    test('the staging security group is tagged atomically at creation', () => {
        const script = read(REPO_ROOT, 'scripts', 'staging', '04-create-security-group.sh');

        expect(script).toContain('--tag-specifications');
        expect(script).toContain('Environment,Value=staging');
        expect(script).toContain('not tagged Environment=staging');
    });
});

describe('production security group carries its environment tag', () => {
    test('the bootstrap tags the security group itself, not only its instances', () => {
        const bootstrap = read(REPO_ROOT, 'infra', 'aws', 'bootstrap-free-tier.ps1');

        expect(bootstrap).toContain('--resources $securityGroupId');
        expect(bootstrap).toContain('Environment,Value=production');
    });
});
