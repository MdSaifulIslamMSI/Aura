const { issueOtpFlowToken } = require('../utils/otpFlowToken');

describe('otpFlowToken', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalOtpFlowSecret = process.env.OTP_FLOW_SECRET;
    const originalJwtSecret = process.env.JWT_SECRET;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        process.env.OTP_FLOW_SECRET = originalOtpFlowSecret;
        process.env.JWT_SECRET = originalJwtSecret;
    });

    test('issues a token when OTP_FLOW_SECRET is configured', () => {
        process.env.NODE_ENV = 'test';
        process.env.OTP_FLOW_SECRET = 'otp-flow-test-secret';

        const { flowToken, flowTokenExpiresAt } = issueOtpFlowToken({
            userId: 'u123',
            purpose: 'login',
        });

        expect(typeof flowToken).toBe('string');
        expect(flowToken.split('.')).toHaveLength(2);
        expect(typeof flowTokenExpiresAt).toBe('string');
    });

    test.each(['development', 'staging', 'production'])(
        'throws when OTP_FLOW_SECRET is missing in %s',
        (nodeEnv) => {
            process.env.NODE_ENV = nodeEnv;
            delete process.env.OTP_FLOW_SECRET;

            expect(() => issueOtpFlowToken({
                userId: 'u123',
                purpose: 'login',
            })).toThrow('OTP_FLOW_SECRET is required');
        }
    );

    test('does not fallback to JWT_SECRET when OTP_FLOW_SECRET is missing', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.OTP_FLOW_SECRET;
        process.env.JWT_SECRET = 'legacy-jwt-secret';

        expect(() => issueOtpFlowToken({
            userId: 'u123',
            purpose: 'login',
        })).toThrow('OTP_FLOW_SECRET is required');
    });
});
