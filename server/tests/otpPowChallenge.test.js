const crypto = require('crypto');
const request = require('supertest');
const app = require('../index');
const User = require('../models/User');

let counter = 0;
const stamp = Date.now();

const uniqueIdentity = () => {
    counter += 1;
    return {
        email: `otp_pow_${stamp}_${counter}@test.com`,
        phone: `8${String(stamp).slice(-4)}${String(counter).padStart(5, '0')}`,
    };
};

const solveChallengeSync = (token, difficulty) => {
    const prefix = '0'.repeat(difficulty);
    let nonce = 0;
    while (true) {
        const hash = crypto.createHash('sha256').update(`${token}.${nonce}`).digest('hex');
        if (hash.startsWith(prefix)) {
            return nonce;
        }
        nonce++;
    }
};

describe('OTP Proof-of-Work Challenge Security', () => {
    let originalPowRequired;
    let originalDifficulty;

    beforeAll(() => {
        originalPowRequired = process.env.OTP_POW_REQUIRED;
        originalDifficulty = process.env.OTP_POW_DIFFICULTY;
    });

    afterAll(() => {
        process.env.OTP_POW_REQUIRED = originalPowRequired;
        process.env.OTP_POW_DIFFICULTY = originalDifficulty;
    });

    beforeEach(() => {
        process.env.OTP_POW_REQUIRED = 'true';
        process.env.OTP_POW_DIFFICULTY = '3';
    });

    test('1. GET /api/otp/challenge generates a valid bound challenge token', async () => {
        const identity = uniqueIdentity();
        const res = await request(app)
            .get(`/api/otp/challenge?email=${identity.email}&phone=${identity.phone}`)
            .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.powToken).toBeDefined();
        expect(res.body.difficulty).toBe(3);

        const parts = res.body.powToken.split('.');
        expect(parts.length).toBe(2);
    });

    test('2. POST /api/otp/send rejects request when powToken and powNonce are missing', async () => {
        const identity = uniqueIdentity();
        const res = await request(app)
            .post('/api/otp/send')
            .send({
                email: identity.email,
                phone: identity.phone,
                purpose: 'signup',
            })
            .expect(400);

        expect(res.body.message).toContain('Proof-of-Work challenge token and nonce are required');
    });

    test('3. POST /api/otp/send rejects invalid solutions or expired tokens', async () => {
        const identity = uniqueIdentity();
        const challengeRes = await request(app)
            .get(`/api/otp/challenge?email=${identity.email}&phone=${identity.phone}`)
            .expect(200);

        const res = await request(app)
            .post('/api/otp/send')
            .send({
                email: identity.email,
                phone: identity.phone,
                purpose: 'signup',
                powToken: challengeRes.body.powToken,
                powNonce: 999999, // invalid nonce
            })
            .expect(400);

        expect(res.body.message).toContain('Proof-of-Work verification failed or challenge expired');
    });

    test('4. POST /api/otp/send accepts valid Proof-of-Work solutions', async () => {
        const identity = uniqueIdentity();
        const challengeRes = await request(app)
            .get(`/api/otp/challenge?email=${identity.email}&phone=${identity.phone}`)
            .expect(200);

        const nonce = solveChallengeSync(challengeRes.body.powToken, challengeRes.body.difficulty);

        const res = await request(app)
            .post('/api/otp/send')
            .send({
                email: identity.email,
                phone: identity.phone,
                purpose: 'signup',
                powToken: challengeRes.body.powToken,
                powNonce: nonce,
            })
            .expect(200);

        expect(res.body.success).toBe(true);
    });

    test('5. verifyPowChallenge rejects solutions solved for a different IP, email, or phone', async () => {
        const identity1 = uniqueIdentity();
        const identity2 = uniqueIdentity();

        const challengeRes = await request(app)
            .get(`/api/otp/challenge?email=${identity1.email}&phone=${identity1.phone}`)
            .expect(200);

        const nonce = solveChallengeSync(challengeRes.body.powToken, challengeRes.body.difficulty);

        const res = await request(app)
            .post('/api/otp/send')
            .send({
                email: identity2.email,
                phone: identity2.phone,
                purpose: 'signup',
                powToken: challengeRes.body.powToken,
                powNonce: nonce,
            })
            .expect(400);

        expect(res.body.message).toContain('Proof-of-Work verification failed or challenge expired');
    });

    test('6. OTP send proceeds without PoW challenge validation when OTP_POW_REQUIRED is false', async () => {
        process.env.OTP_POW_REQUIRED = 'false';
        const identity = uniqueIdentity();

        const res = await request(app)
            .post('/api/otp/send')
            .send({
                email: identity.email,
                phone: identity.phone,
                purpose: 'signup',
            })
            .expect(200);

        expect(res.body.success).toBe(true);
    });
});
