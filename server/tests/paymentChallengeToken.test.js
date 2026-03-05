const crypto = require('crypto');
const AppError = require('../utils/AppError');
const {
    issuePaymentChallengeToken,
    verifyPaymentChallengeToken,
} = require('../utils/paymentChallengeToken');

const sign = (payloadB64, secret) => crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64url');

describe('Payment Challenge Token', () => {
    test('issues and verifies token for payment challenge', () => {
        const issued = issuePaymentChallengeToken({
            userId: '507f191e810c19729de860ea',
            phone: '+919999999999',
            intentId: 'pi_test_123',
        });

        expect(issued.challengeToken).toBeTruthy();
        expect(issued.challengeExpiresAt).toBeTruthy();

        const payload = verifyPaymentChallengeToken(issued.challengeToken);
        expect(payload.sub).toBe('507f191e810c19729de860ea');
        expect(payload.phone).toBe('+919999999999');
        expect(payload.intentId).toBe('pi_test_123');
        expect(payload.purpose).toBe('payment-challenge');
    });

    test('rejects tampered token signature', () => {
        const issued = issuePaymentChallengeToken({
            userId: 'u1',
            phone: '+911111111111',
            intentId: 'pi_1',
        });

        const [payloadB64] = issued.challengeToken.split('.');
        const tampered = `${payloadB64}.invalid_signature`;
        expect(() => verifyPaymentChallengeToken(tampered)).toThrow(AppError);
    });

    test('rejects expired challenge token', () => {
        process.env.OTP_CHALLENGE_SECRET = process.env.OTP_CHALLENGE_SECRET || 'test-secret';
        const nowSec = Math.floor(Date.now() / 1000);
        const payload = {
            sub: 'u2',
            phone: '+922222222222',
            intentId: 'pi_2',
            purpose: 'payment-challenge',
            iat: nowSec - 1000,
            exp: nowSec - 10,
        };
        const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
        const signature = sign(payloadB64, process.env.OTP_CHALLENGE_SECRET || process.env.JWT_SECRET || 'dev-payment-challenge-secret');
        const token = `${payloadB64}.${signature}`;

        expect(() => verifyPaymentChallengeToken(token)).toThrow('expired');
    });
});
