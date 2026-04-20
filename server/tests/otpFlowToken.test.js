const { issueOtpFlowToken, verifyOtpFlowToken } = require('../utils/otpFlowToken');
const buildRuntimeSecret = (label = 'test') => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}-suite`;

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
        process.env.OTP_FLOW_SECRET = buildRuntimeSecret('otp-flow');

        const { flowToken, flowTokenExpiresAt, tokenState } = issueOtpFlowToken({
            userId: 'u123',
            purpose: 'login',
        });

        expect(typeof flowToken).toBe('string');
        expect(flowToken.split('.')).toHaveLength(2);
        expect(flowToken.split('.')[0]).toBe('v1');
        expect(flowToken).not.toContain('u123');
        expect(typeof flowTokenExpiresAt).toBe('string');
        expect(tokenState).toMatchObject({
            tokenId: expect.any(String),
            nextStep: 'auth-sync',
        });
    });

    test('verifies a token and preserves the factor claim and signal bond', () => {
        process.env.NODE_ENV = 'test';
        process.env.OTP_FLOW_SECRET = buildRuntimeSecret('otp-flow');

        const { flowToken } = issueOtpFlowToken({
            userId: 'u123',
            purpose: 'login',
            factor: 'email',
            signalBond: {
                deviceId: 'device-123',
                deviceSessionHash: 'session-hash-123',
                authUid: 'uid-123',
            },
        });

        expect(verifyOtpFlowToken({
            token: flowToken,
            expectedPurpose: 'login',
            expectedSubject: 'u123',
            expectedSignalBond: {
                deviceId: 'device-123',
                deviceSessionHash: 'session-hash-123',
                authUid: 'uid-123',
            },
            expectedNextStep: 'auth-sync',
        })).toMatchObject({
            tokenId: expect.any(String),
            sub: 'u123',
            purpose: 'login',
            factor: 'email',
            nextStep: 'auth-sync',
            signalBond: {
                deviceId: 'device-123',
                deviceSessionHash: 'session-hash-123',
                authUid: 'uid-123',
            },
        });
    });

    test('rejects a token when the expected subject does not match', () => {
        process.env.NODE_ENV = 'test';
        process.env.OTP_FLOW_SECRET = buildRuntimeSecret('otp-flow');

        const { flowToken } = issueOtpFlowToken({
            userId: 'u123',
            purpose: 'login',
        });

        expect(() => verifyOtpFlowToken({
            token: flowToken,
            expectedPurpose: 'login',
            expectedSubject: 'u999',
        })).toThrow('Login assurance token does not match this account');
    });

    test('rejects a token when the expected factor does not match', () => {
        process.env.NODE_ENV = 'test';
        process.env.OTP_FLOW_SECRET = buildRuntimeSecret('otp-flow');

        const { flowToken } = issueOtpFlowToken({
            userId: 'u123',
            purpose: 'forgot-password',
            factor: 'email',
        });

        expect(() => verifyOtpFlowToken({
            token: flowToken,
            expectedPurpose: 'forgot-password',
            expectedFactor: 'otp',
        })).toThrow('Login assurance token factor mismatch');
    });

    test('rejects a token when the device bond does not match', () => {
        process.env.NODE_ENV = 'test';
        process.env.OTP_FLOW_SECRET = buildRuntimeSecret('otp-flow');

        const { flowToken } = issueOtpFlowToken({
            userId: 'u123',
            purpose: 'forgot-password',
            factor: 'otp',
            signalBond: {
                deviceId: 'device-123',
            },
        });

        expect(() => verifyOtpFlowToken({
            token: flowToken,
            expectedPurpose: 'forgot-password',
            expectedFactor: 'otp',
            expectedSignalBond: {
                deviceId: 'device-999',
            },
        })).toThrow('Login assurance token device bond mismatch');
    });

    test('rejects a token when the trusted device session proof does not match', () => {
        process.env.NODE_ENV = 'test';
        process.env.OTP_FLOW_SECRET = buildRuntimeSecret('otp-flow');

        const { flowToken } = issueOtpFlowToken({
            userId: 'u123',
            purpose: 'forgot-password',
            factor: 'otp',
            signalBond: {
                deviceId: 'device-123',
                deviceSessionHash: 'session-hash-123',
            },
        });

        expect(() => verifyOtpFlowToken({
            token: flowToken,
            expectedPurpose: 'forgot-password',
            expectedFactor: 'otp',
            expectedSignalBond: {
                deviceId: 'device-123',
                deviceSessionHash: 'session-hash-999',
            },
        })).toThrow('trusted device session mismatch');
    });

    test('rejects a token when the expected next step does not match', () => {
        process.env.NODE_ENV = 'test';
        process.env.OTP_FLOW_SECRET = buildRuntimeSecret('otp-flow');

        const { flowToken } = issueOtpFlowToken({
            userId: 'u123',
            purpose: 'login',
            factor: 'otp',
        });

        expect(() => verifyOtpFlowToken({
            token: flowToken,
            expectedPurpose: 'login',
            expectedNextStep: 'reset-password',
        })).toThrow('Login assurance token next step mismatch');
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
        process.env.JWT_SECRET = buildRuntimeSecret('legacy-jwt');

        expect(() => issueOtpFlowToken({
            userId: 'u123',
            purpose: 'login',
        })).toThrow('OTP_FLOW_SECRET is required');
    });
});
