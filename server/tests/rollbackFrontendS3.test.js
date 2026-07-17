const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const bash = process.platform === 'win32'
    ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
    : 'bash';

const runRollback = (snapshotState) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-frontend-rollback-'));
    const harness = path.join(dir, 'run-rollback.sh');
    const trace = path.join(dir, 'aws.trace');

    fs.writeFileSync(harness, `#!/usr/bin/env bash
set -euo pipefail

aws() {
  printf '%s\\n' "$*" >> "\${AWS_MOCK_TRACE}"
  case "$1 $2" in
    's3api head-object')
      [[ "\${AWS_MOCK_SNAPSHOT_STATE}" == 'valid' ]]
      ;;
    's3 ls')
      # A nonexistent S3 prefix is still a successful listing. Keeping this
      # behavior in the mock makes the test fail against the old implementation.
      return 0
      ;;
    's3 sync'|'cloudfront create-invalidation')
      return 0
      ;;
    *)
      return 0
      ;;
  esac
}

source infra/aws/rollback-frontend-s3.sh
`);

    try {
        const output = execFileSync(bash, [harness], {
            cwd: repoRoot,
            encoding: 'utf8',
            env: {
                ...process.env,
                ROLLBACK_REF: 'requested-release',
                AWS_FRONTEND_BUCKET: 'test-storefront-bucket',
                AWS_FRONTEND_DISTRIBUTION_ID: 'test-distribution',
                AWS_FRONTEND_PUBLIC_URL: '',
                AWS_MOCK_SNAPSHOT_STATE: snapshotState,
                AWS_MOCK_TRACE: trace,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return {
            status: 0,
            output,
            trace: fs.readFileSync(trace, 'utf8'),
        };
    } catch (error) {
        return {
            status: error.status || 1,
            output: `${error.stdout || ''}${error.stderr || ''}`,
            trace: fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8') : '',
        };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

describe('AWS frontend snapshot rollback', () => {
    test.each(['missing', 'partial'])(
        '%s snapshot never reaches destructive S3 sync',
        (snapshotState) => {
            const result = runRollback(snapshotState);

            expect(result.status).not.toBe(0);
            expect(result.output).toContain('No completed AWS frontend rollback snapshot matched');
            expect(result.output).not.toContain('Restoring AWS frontend from');
            expect(result.trace).toContain(
                's3api head-object --region ap-south-1 --bucket test-storefront-bucket ' +
                '--key _aura-rollback/requested-release/.aura-rollback-manifest.json'
            );
            expect(result.trace).not.toContain('s3 sync');
        }
    );

    test('completed snapshot manifest permits the intended restore sync', () => {
        const result = runRollback('valid');

        expect(result.status).toBe(0);
        expect(result.output).toContain(
            'Restoring AWS frontend from s3://test-storefront-bucket/_aura-rollback/requested-release/.'
        );
        expect(result.trace).toContain(
            's3api head-object --region ap-south-1 --bucket test-storefront-bucket ' +
            '--key _aura-rollback/requested-release/.aura-rollback-manifest.json'
        );
        expect(result.trace).toContain(
            's3 sync s3://test-storefront-bucket/_aura-rollback/requested-release ' +
            's3://test-storefront-bucket --region ap-south-1 --delete'
        );
    });
});
