describe('signingSecrets config assertions', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalOtpFlowSecret = process.env.OTP_FLOW_SECRET;
    const originalUploadSigningSecret = process.env.UPLOAD_SIGNING_SECRET;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        process.env.OTP_FLOW_SECRET = originalOtpFlowSecret;
        process.env.UPLOAD_SIGNING_SECRET = originalUploadSigningSecret;
        jest.resetModules();
    });

    test('does not throw in test mode when secrets are missing', () => {
        process.env.NODE_ENV = 'test';
        delete process.env.OTP_FLOW_SECRET;
        delete process.env.UPLOAD_SIGNING_SECRET;

        const { assertSigningSecretsConfig } = require('../config/signingSecrets');
        expect(() => assertSigningSecretsConfig()).not.toThrow();
    });

    test.each(['development', 'staging', 'production'])(
        'throws in %s when OTP_FLOW_SECRET is missing',
        (nodeEnv) => {
            process.env.NODE_ENV = nodeEnv;
            delete process.env.OTP_FLOW_SECRET;
            process.env.UPLOAD_SIGNING_SECRET = 'upload-secret';

            const { assertSigningSecretsConfig } = require('../config/signingSecrets');
            expect(() => assertSigningSecretsConfig()).toThrow(
                'OTP_FLOW_SECRET is required when NODE_ENV is not "test"'
            );
        }
    );

    test.each(['development', 'staging', 'production'])(
        'throws in %s when UPLOAD_SIGNING_SECRET is missing',
        (nodeEnv) => {
            process.env.NODE_ENV = nodeEnv;
            process.env.OTP_FLOW_SECRET = 'otp-secret';
            delete process.env.UPLOAD_SIGNING_SECRET;

            const { assertSigningSecretsConfig } = require('../config/signingSecrets');
            expect(() => assertSigningSecretsConfig()).toThrow(
                'UPLOAD_SIGNING_SECRET is required when NODE_ENV is not "test"'
            );
        }
    );
});
