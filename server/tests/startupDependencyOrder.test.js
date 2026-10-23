const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_ROOT = path.resolve(__dirname, '..');

const read = (...segments) => fs.readFileSync(path.join(...segments), 'utf8');

// Startup order is a security property, not an implementation detail: the API
// must not accept traffic while encrypted-field reads would throw, and the
// worker must not claim jobs before its DEK exists. These are source-order
// assertions because both entrypoints intentionally run only as `main`.
describe('runtime dependency startup order', () => {
    test('the API primes encryption and Redis before binding the listener', () => {
        const source = read(SERVER_ROOT, 'index.js');
        const connectIndex = source.indexOf('connectDB()');
        const primeIndex = source.indexOf('await primeFieldEncryption();');
        const redisIndex = source.indexOf('await initRedis();');
        const listenIndex = source.indexOf('server.listen(PORT');

        expect(connectIndex).toBeGreaterThan(-1);
        expect(primeIndex).toBeGreaterThan(connectIndex);
        expect(redisIndex).toBeGreaterThan(primeIndex);
        expect(listenIndex).toBeGreaterThan(redisIndex);
        expect(source).toContain("logger.error('server.startup_failed'");
        expect(source).not.toContain('server.db_connect_failed');
    });

    test('the worker primes encryption before it starts any background worker', () => {
        const source = read(SERVER_ROOT, 'workerProcess.js');
        const primeIndex = source.indexOf('await primeFieldEncryption();');
        const workerStartIndex = source.indexOf('startPaymentOutboxWorker();');

        expect(source).toContain('primeFieldEncryption,');
        expect(primeIndex).toBeGreaterThan(-1);
        expect(workerStartIndex).toBeGreaterThan(primeIndex);
    });

    test('the production instance role can persist the wrapped DEK without broad SSM write', () => {
        const bootstrap = read(REPO_ROOT, 'infra', 'aws', 'bootstrap-free-tier.ps1');

        expect(bootstrap).toContain('FieldEncryptionKmsKeyArn');
        expect(bootstrap).toContain('PersistWrappedFieldEncryptionDek');
        expect(bootstrap).toContain('FIELD_ENCRYPTION_WRAPPED_DEK');
        expect(bootstrap).toContain('"ssm:PutParameter"');
        expect(bootstrap).toContain('FieldEncryptionKms');
        expect(bootstrap).toContain('kms:GenerateDataKey');
        expect(bootstrap).toContain('SsmSecureStringKms');
        expect(bootstrap).toContain('"kms:ViaService"');
    });

    test('the staging instance role can use the field-encryption key', () => {
        const bootstrap = read(REPO_ROOT, 'scripts', 'staging', '00-create-iam-auth.sh');

        expect(bootstrap).toContain('UseStagingFieldEncryptionKms');
        expect(bootstrap).toContain('kms:GenerateDataKey');
        expect(bootstrap).toContain('arn:aws:kms:$AWS_REGION:$AWS_ACCOUNT_ID:key/*');
    });
});
