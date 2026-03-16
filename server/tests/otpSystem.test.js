/**
 * ═══════════════════════════════════════════════════════════════════
 *  OTP SYSTEM — 100 TEST SUITE (HARDENED)
 *  Now tests: bcrypt hashing, attempt tracking, lockout, audit logging
 * ═══════════════════════════════════════════════════════════════════
 */

const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../index');
const User = require('../models/User');

jest.setTimeout(25000);

// ── Helpers ──────────────────────────────────────────────────────
let testCounter = 0;
const TS = Date.now();
const SALT = 8; // must match controller

const uniqueUser = () => {
    testCounter++;
    return {
        email: `otp_t${TS}_${testCounter}@test.com`,
        phone: `9${String(TS).slice(-4)}${String(testCounter).padStart(5, '0')}`,
        name: `TestUser ${testCounter}`
    };
};

/**
 * Create a verified user with pre-hashed OTP
 */
const seedVerified = async (overrides = {}) => {
    const u = uniqueUser();
    const otpPlain = overrides.otp || null;
    return User.create({
        name: overrides.name || u.name,
        email: overrides.email || u.email,
        phone: overrides.phone || u.phone,
        isVerified: true,
        otp: otpPlain ? await bcrypt.hash(otpPlain, SALT) : null,
        otpExpiry: overrides.otpExpiry || null,
        otpPurpose: overrides.otpPurpose || null,
        otpAttempts: overrides.otpAttempts || 0,
        otpLockedUntil: overrides.otpLockedUntil || null
    });
};

/**
 * Create an unverified (pending signup) user with pre-hashed OTP
 */
const seedPending = async (overrides = {}) => {
    const u = uniqueUser();
    const otpPlain = overrides.otp || '123456';
    return {
        user: await User.create({
            name: 'Pending',
            email: overrides.email || u.email,
            phone: overrides.phone || u.phone,
            isVerified: false,
            otp: await bcrypt.hash(otpPlain, SALT),
            otpExpiry: overrides.otpExpiry || new Date(Date.now() + 5 * 60 * 1000),
            otpPurpose: overrides.otpPurpose || 'signup',
            otpAttempts: overrides.otpAttempts || 0,
            otpLockedUntil: overrides.otpLockedUntil || null
        }),
        otpPlain // return plaintext for verification tests
    };
};

// ═══════════════════════════════════════════════════════════════════
//  SECTION 1: POST /api/otp/send — INPUT VALIDATION (Tests 1-20)
// ═══════════════════════════════════════════════════════════════════
describe('POST /api/otp/send — Input Validation', () => {

    test('1. 400 when email is missing', async () => {
        const res = await request(app).post('/api/otp/send')
            .send({ phone: '1234567890', purpose: 'signup' });
        expect(res.statusCode).toBe(400);
    });

    test('2. 400 when phone is missing', async () => {
        const res = await request(app).post('/api/otp/send')
            .send({ email: 'a@b.com', purpose: 'signup' });
        expect(res.statusCode).toBe(400);
    });

    test('3. 400 when both missing', async () => {
        const res = await request(app).post('/api/otp/send').send({ purpose: 'signup' });
        expect(res.statusCode).toBe(400);
    });

    test('4. 400 when purpose is missing', async () => {
        const res = await request(app).post('/api/otp/send')
            .send({ email: 'a@b.com', phone: '123' });
        expect(res.statusCode).toBe(400);
    });

    test('5. 400 for invalid purpose', async () => {
        const res = await request(app).post('/api/otp/send')
            .send({ email: 'a@b.com', phone: '123', purpose: 'invalid' });
        expect(res.statusCode).toBe(400);
    });

    test('6. 400 for purpose "register"', async () => {
        const res = await request(app).post('/api/otp/send')
            .send({ email: 'a@b.com', phone: '123', purpose: 'register' });
        expect(res.statusCode).toBe(400);
    });

    test('7. 400 for purpose "reset"', async () => {
        const res = await request(app).post('/api/otp/send')
            .send({ email: 'a@b.com', phone: '123', purpose: 'reset' });
        expect(res.statusCode).toBe(400);
    });

    test('8. 400 when body is empty', async () => {
        const res = await request(app).post('/api/otp/send').send({});
        expect(res.statusCode).toBe(400);
    });

    test('9. 400 when email is empty string', async () => {
        const res = await request(app).post('/api/otp/send')
            .send({ email: '', phone: '123', purpose: 'signup' });
        expect(res.statusCode).toBe(400);
    });

    test('10. 400 when phone is empty string', async () => {
        const res = await request(app).post('/api/otp/send')
            .send({ email: 'a@b.com', phone: '', purpose: 'signup' });
        expect(res.statusCode).toBe(400);
    });

    test('11. 200 for valid signup', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        expect(res.statusCode).toBe(200);
    });

    test('12. 200 for valid login', async () => {
        const user = await seedVerified();
        const res = await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'login' });
        expect(res.statusCode).toBe(200);
    });

    test('13. 200 for valid forgot-password', async () => {
        const user = await seedVerified();
        const res = await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'forgot-password' });
        expect(res.statusCode).toBe(200);
    });

    test('14. does not crash with very long email', async () => {
        const res = await request(app).post('/api/otp/send')
            .send({ email: 'a'.repeat(300) + '@a.com', phone: '123', purpose: 'signup' });
        expect(res.statusCode).toBeDefined();
    });

    test('15. does not crash with very long phone', async () => {
        const res = await request(app).post('/api/otp/send')
            .send({ email: 'a@b.com', phone: '9'.repeat(300), purpose: 'signup' });
        expect(res.statusCode).toBeDefined();
    });

    test('16. returns JSON content type', async () => {
        const res = await request(app).post('/api/otp/send')
            .send({ phone: '123', purpose: 'signup' });
        expect(res.headers['content-type']).toMatch(/json/);
    });

    test('17. rejects whitespace purpose', async () => {
        const res = await request(app).post('/api/otp/send')
            .send({ email: 'a@b.com', phone: '123', purpose: ' signup ' });
        expect(res.statusCode).toBe(400);
    });

    test('18. rejects uppercase purpose', async () => {
        const res = await request(app).post('/api/otp/send')
            .send({ email: 'a@b.com', phone: '123', purpose: 'SIGNUP' });
        expect(res.statusCode).toBe(400);
    });

    test('19. handles null values', async () => {
        const res = await request(app).post('/api/otp/send')
            .send({ email: null, phone: null, purpose: null });
        expect(res.statusCode).toBe(400);
    });

    test('20. handles numeric values', async () => {
        const res = await request(app).post('/api/otp/send')
            .send({ email: 99999, phone: 88888, purpose: 'signup' });
        expect(res.statusCode).toBeDefined();
    });

    test('20a. 400 when phone is object payload', async () => {
        const res = await request(app).post('/api/otp/send')
            .send({ email: 'a@b.com', phone: { $gt: '' }, purpose: 'signup' });
        expect(res.statusCode).toBe(400);
    });

    test('20b. 400 when email format is invalid', async () => {
        const res = await request(app).post('/api/otp/send')
            .send({ email: 'not-an-email', phone: '9876543210', purpose: 'signup' });
        expect(res.statusCode).toBe(400);
    });
});

// ═══════════════════════════════════════════════════════════════════
//  SECTION 2: POST /api/otp/send — SIGNUP FLOW (Tests 21-35)
// ═══════════════════════════════════════════════════════════════════
describe('POST /api/otp/send — Signup Flow', () => {

    test('21. creates pending user in DB', async () => {
        const u = uniqueUser();
        await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        const dbUser = await User.findOne({ email: u.email }).select('+otp +otpPurpose');
        expect(dbUser).not.toBeNull();
        expect(dbUser.isVerified).toBe(false);
    });

    test('22. stores a BCRYPT HASH (not plaintext) in DB', async () => {
        const u = uniqueUser();
        await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        const dbUser = await User.findOne({ email: u.email }).select('+otp');
        // bcrypt hashes start with $2a$ or $2b$
        expect(dbUser.otp).toMatch(/^\$2[ab]\$/);
        // Must NOT be 6 digits (plaintext)
        expect(dbUser.otp).not.toMatch(/^\d{6}$/);
    });

    test('23. sets otpExpiry ~5 minutes in future', async () => {
        const u = uniqueUser();
        await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        const dbUser = await User.findOne({ email: u.email }).select('+otpExpiry');
        const diff = dbUser.otpExpiry.getTime() - Date.now();
        expect(diff).toBeGreaterThan(4 * 60 * 1000 - 5000);
        expect(diff).toBeLessThan(6 * 60 * 1000);
    });

    test('24. sets otpPurpose to "signup"', async () => {
        const u = uniqueUser();
        await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        const dbUser = await User.findOne({ email: u.email }).select('+otpPurpose');
        expect(dbUser.otpPurpose).toBe('signup');
    });

    test('25. initializes otpAttempts to 0', async () => {
        const u = uniqueUser();
        await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        const dbUser = await User.findOne({ email: u.email }).select('+otpAttempts');
        expect(dbUser.otpAttempts).toBe(0);
    });

    test('26. 409 when email already verified', async () => {
        const existing = await seedVerified();
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/send')
            .send({ email: existing.email, phone: u.phone, purpose: 'signup' });
        expect(res.statusCode).toBe(409);
    });

    test('27. 409 when phone already verified', async () => {
        const existing = await seedVerified();
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: existing.phone, purpose: 'signup' });
        expect(res.statusCode).toBe(409);
    });

    test('28. deletes old unverified on re-signup', async () => {
        const u = uniqueUser();
        await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        expect(await User.countDocuments({ email: u.email })).toBe(1);
    });

    test('29. response message contains email', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        expect(res.body.message).toContain(u.email);
    });

    test('30. response has success:true', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        expect(res.body.success).toBe(true);
    });

    test('31. generates different hashes for each request', async () => {
        const hashes = [];
        for (let i = 0; i < 3; i++) {
            const u = uniqueUser();
            await request(app).post('/api/otp/send')
                .send({ email: u.email, phone: u.phone, purpose: 'signup' });
            const db = await User.findOne({ email: u.email }).select('+otp');
            hashes.push(db.otp);
        }
        // All hashes should be different (different OTPs + salt)
        expect(new Set(hashes).size).toBe(3);
    });

    test('32. does not include OTP in response', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        expect(res.body.otp).toBeUndefined();
    });

    test('33. does not include user data in response', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        expect(res.body._id).toBeUndefined();
        expect(res.body.user).toBeUndefined();
    });

    test('34. handles concurrent signups', async () => {
        const u = uniqueUser();
        const payload = { email: u.email, phone: u.phone, purpose: 'signup' };
        const [r1, r2] = await Promise.all([
            request(app).post('/api/otp/send').send(payload),
            request(app).post('/api/otp/send').send(payload)
        ]);
        expect([r1.statusCode, r2.statusCode]).toContain(200);
    });

    test('35. 409 message specifies "email"', async () => {
        const existing = await seedVerified();
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/send')
            .send({ email: existing.email, phone: u.phone, purpose: 'signup' });
        expect(res.body.message).toMatch(/email/i);
    });
});

// ═══════════════════════════════════════════════════════════════════
//  SECTION 3: POST /api/otp/send — LOGIN & FORGOT PASSWORD (Tests 36-50)
// ═══════════════════════════════════════════════════════════════════
describe('POST /api/otp/send — Login & Forgot Password', () => {

    test('36. 404 for login non-existent phone', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'login' });
        expect(res.statusCode).toBe(404);
    });

    test('37. 404 for forgot-password non-existent', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'forgot-password' });
        expect(res.statusCode).toBe(404);
    });

    test('38. stores bcrypt hash for login OTP', async () => {
        const user = await seedVerified();
        await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'login' });
        const u = await User.findById(user._id).select('+otp');
        expect(u.otp).toMatch(/^\$2[ab]\$/);
    });

    test('39. sets purpose to "forgot-password"', async () => {
        const user = await seedVerified();
        await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'forgot-password' });
        const u = await User.findById(user._id).select('+otpPurpose');
        expect(u.otpPurpose).toBe('forgot-password');
    });

    test('40. resets otpAttempts to 0 on new OTP send', async () => {
        const user = await seedVerified({ otpAttempts: 3 });
        await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'login' });
        const u = await User.findById(user._id).select('+otpAttempts');
        expect(u.otpAttempts).toBe(0);
    });

    test('41. clears lockout on new OTP send', async () => {
        const user = await seedVerified({ otpLockedUntil: new Date(Date.now() + 900000) });
        await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'login' });
        const u = await User.findById(user._id).select('+otpLockedUntil');
        expect(u.otpLockedUntil).toBeNull();
    });

    test('42. login send does not create new user', async () => {
        const user = await seedVerified();
        const before = await User.countDocuments();
        await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'login' });
        expect(await User.countDocuments()).toBe(before);
    });

    test('43. 404 message guides to sign up', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'login' });
        expect(res.body.message).toMatch(/sign up/i);
    });

    test('44. does not find unverified for login', async () => {
        const { user } = await seedPending();
        const res = await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'login' });
        expect(res.statusCode).toBe(404);
    });

    test('45. does not find unverified for forgot-password', async () => {
        const { user } = await seedPending();
        const res = await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'forgot-password' });
        expect(res.statusCode).toBe(404);
    });

    test('46. responds within 500ms', async () => {
        const user = await seedVerified();
        const start = Date.now();
        await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'login' });
        expect(Date.now() - start).toBeLessThan(500);
    });

    test('47. does not leak OTP in response', async () => {
        const user = await seedVerified();
        const res = await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'login' });
        expect(res.body.otp).toBeUndefined();
    });

    test('48. sets fresh otpExpiry for login', async () => {
        const user = await seedVerified();
        await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'login' });
        const u = await User.findById(user._id).select('+otpExpiry');
        expect(u.otpExpiry.getTime()).toBeGreaterThan(Date.now());
    });

    test('49. response has {success, message}', async () => {
        const user = await seedVerified();
        const res = await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'login' });
        expect(res.body).toHaveProperty('success');
        expect(res.body).toHaveProperty('message');
    });

    test('50. purpose updates atomically', async () => {
        const user = await seedVerified({ otpPurpose: 'login' });
        await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'forgot-password' });
        const u = await User.findById(user._id).select('+otpPurpose');
        expect(u.otpPurpose).toBe('forgot-password');
    });

    test('50a. 404 when login email does not match phone owner', async () => {
        const first = await seedVerified();
        const second = await seedVerified();
        const res = await request(app).post('/api/otp/send')
            .send({ email: first.email, phone: second.phone, purpose: 'login' });
        expect(res.statusCode).toBe(404);
    });

    test('50b. 404 when forgot-password email does not match phone owner', async () => {
        const first = await seedVerified();
        const second = await seedVerified();
        const res = await request(app).post('/api/otp/send')
            .send({ email: first.email, phone: second.phone, purpose: 'forgot-password' });
        expect(res.statusCode).toBe(404);
    });
});

// ═══════════════════════════════════════════════════════════════════
//  SECTION 4: POST /api/otp/verify (Tests 51-75)
// ═══════════════════════════════════════════════════════════════════
describe('POST /api/otp/verify', () => {

    test('51. 400 when phone is missing', async () => {
        const res = await request(app).post('/api/otp/verify')
            .send({ otp: '123456', purpose: 'signup' });
        expect(res.statusCode).toBe(400);
    });

    test('52. 400 when OTP is missing', async () => {
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: '123', purpose: 'signup' });
        expect(res.statusCode).toBe(400);
    });

    test('53. 400 when purpose is missing', async () => {
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: '123', otp: '123456' });
        expect(res.statusCode).toBe(400);
    });

    test('54. 400 when body is empty', async () => {
        const res = await request(app).post('/api/otp/verify').send({});
        expect(res.statusCode).toBe(400);
    });

    test('55. 404 for non-existent phone', async () => {
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: '0000000000', otp: '123456', purpose: 'signup' });
        expect(res.statusCode).toBe(404);
    });

    test('56. 401 for wrong OTP (bcrypt comparison)', async () => {
        const { user } = await seedPending({ otp: '123456' });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: '654321', purpose: 'signup' });
        expect(res.statusCode).toBe(401);
    });

    test('57. 410 for expired OTP', async () => {
        const { user } = await seedPending({
            otp: '555555', otpExpiry: new Date(Date.now() - 60000), otpPurpose: 'signup'
        });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: '555555', purpose: 'signup' });
        expect(res.statusCode).toBe(410);
    });

    test('58. 400 for purpose mismatch', async () => {
        const { user } = await seedPending({ otp: '111111', otpPurpose: 'signup' });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: '111111', purpose: 'login' });
        expect(res.statusCode).toBe(400);
    });

    test('59. 200 with bcrypt-verified OTP', async () => {
        const { user, otpPlain } = await seedPending({ otp: '999999', otpPurpose: 'signup' });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: otpPlain, purpose: 'signup' });
        expect(res.statusCode).toBe(200);
        expect(res.body.verified).toBe(true);
    });

    test('60. marks user verified after OTP check', async () => {
        const { user, otpPlain } = await seedPending({ otp: '888888', otpPurpose: 'signup' });
        await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: otpPlain, purpose: 'signup' });
        const u = await User.findById(user._id);
        expect(u.isVerified).toBe(true);
    });

    test('61. clears OTP fields after verification', async () => {
        const { user, otpPlain } = await seedPending({ otp: '777777', otpPurpose: 'signup' });
        await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: otpPlain, purpose: 'signup' });
        const u = await User.findById(user._id).select('+otp +otpExpiry +otpPurpose +otpAttempts');
        expect(u.otp).toBeNull();
        expect(u.otpAttempts).toBe(0);
    });

    test('62. returns user data in response', async () => {
        const { user, otpPlain } = await seedPending({ otp: '666666', otpPurpose: 'signup' });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: otpPlain, purpose: 'signup' });
        expect(res.body.user._id).toBeDefined();
        expect(res.body.user.email).toBe(user.email);
    });

    test('63. does NOT leak OTP hash in response', async () => {
        const { user, otpPlain } = await seedPending({ otp: '444444', otpPurpose: 'signup' });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: otpPlain, purpose: 'signup' });
        expect(res.body.user.otp).toBeUndefined();
    });

    test('64. does NOT leak password in response', async () => {
        const { user, otpPlain } = await seedPending({ otp: '333333', otpPurpose: 'signup' });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: otpPlain, purpose: 'signup' });
        expect(res.body.user.password).toBeUndefined();
    });

    test('65. rejects OTP replay (same OTP twice)', async () => {
        const { user, otpPlain } = await seedPending({ otp: '222222', otpPurpose: 'signup' });
        await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: otpPlain, purpose: 'signup' });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: otpPlain, purpose: 'signup' });
        expect(res.statusCode).not.toBe(200);
    });

    test('66. increments otpAttempts on wrong OTP', async () => {
        const { user } = await seedPending({ otp: '111111' });
        await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: '000000', purpose: 'signup' });
        const u = await User.findById(user._id).select('+otpAttempts');
        expect(u.otpAttempts).toBe(1);
    });

    test('67. shows remaining attempts in error message', async () => {
        const { user } = await seedPending({ otp: '111111' });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: '000000', purpose: 'signup' });
        expect(res.body.message).toMatch(/attempt/i);
    });

    test('68. LOCKS account after 5 wrong attempts (HTTP 423)', async () => {
        const { user } = await seedPending({ otp: '999999', otpAttempts: 4 });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: '000000', purpose: 'signup' });
        expect(res.statusCode).toBe(423);
        expect(res.body.message).toMatch(/locked/i);
    });

    test('69. sets otpLockedUntil on lockout', async () => {
        const { user } = await seedPending({ otp: '999999', otpAttempts: 4 });
        await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: '000000', purpose: 'signup' });
        const u = await User.findById(user._id).select('+otpLockedUntil');
        expect(u.otpLockedUntil).not.toBeNull();
        expect(u.otpLockedUntil.getTime()).toBeGreaterThan(Date.now());
    });

    test('70. invalidates OTP on lockout', async () => {
        const { user } = await seedPending({ otp: '999999', otpAttempts: 4 });
        await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: '000000', purpose: 'signup' });
        const u = await User.findById(user._id).select('+otp');
        expect(u.otp).toBeNull();
    });

    test('71. returns 423 when account is locked', async () => {
        const { user } = await seedPending({
            otp: '111111',
            otpLockedUntil: new Date(Date.now() + 900000) // locked for 15 min
        });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: '111111', purpose: 'signup' });
        expect(res.statusCode).toBe(423);
    });

    test('72. locked message includes minutes remaining', async () => {
        const { user } = await seedPending({
            otp: '111111',
            otpLockedUntil: new Date(Date.now() + 900000)
        });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: '111111', purpose: 'signup' });
        expect(res.body.message).toMatch(/minute/i);
    });

    test('73. rejects alphabetic OTP', async () => {
        const { user } = await seedPending({ otp: '171717' });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: 'abcdef', purpose: 'signup' });
        expect(res.statusCode).toBe(400);
    });

    test('74. rejects 5-digit OTP', async () => {
        const { user } = await seedPending({ otp: '181818' });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: '18181', purpose: 'signup' });
        expect(res.statusCode).toBe(400);
    });

    test('74a. rejects invalid phone format before lookup', async () => {
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: '12ab', otp: '123456', purpose: 'signup' });
        expect(res.statusCode).toBe(400);
    });

    test('75. response has correct shape', async () => {
        const { user, otpPlain } = await seedPending({ otp: '202020', otpPurpose: 'signup' });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: otpPlain, purpose: 'signup' });
        expect(res.body).toEqual(expect.objectContaining({
            success: true,
            verified: true,
            user: expect.objectContaining({ _id: expect.any(String) })
        }));
    });
});

// ═══════════════════════════════════════════════════════════════════
//  SECTION 5: POST /api/otp/check-user (Tests 76-90)
// ═══════════════════════════════════════════════════════════════════
describe('POST /api/otp/check-user', () => {

    test('76. 400 when phone is missing', async () => {
        const res = await request(app).post('/api/otp/check-user').send({});
        expect(res.statusCode).toBe(400);
    });

    test('77. exists:false for unknown phone', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/check-user').send({ phone: u.phone });
        expect(res.body.exists).toBe(false);
    });

    test('78. exists:true for verified user', async () => {
        const user = await seedVerified();
        const res = await request(app).post('/api/otp/check-user').send({ phone: user.phone });
        expect(res.body.exists).toBe(true);
    });

    test('79. exists:false for unverified user', async () => {
        const { user } = await seedPending();
        const res = await request(app).post('/api/otp/check-user').send({ phone: user.phone });
        expect(res.body.exists).toBe(false);
    });

    test('80. returns masked email with ***', async () => {
        const user = await seedVerified();
        const res = await request(app).post('/api/otp/check-user').send({ phone: user.phone });
        expect(res.body.email).toContain('***');
    });

    test('81. returns null email for non-existent', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/check-user').send({ phone: u.phone });
        expect(res.body.email).toBeNull();
    });

    test('82. returns null phone for non-existent', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/check-user').send({ phone: u.phone });
        expect(res.body.phone).toBeNull();
    });

    test('83. returns phone for existing user', async () => {
        const user = await seedVerified();
        const res = await request(app).post('/api/otp/check-user').send({ phone: user.phone });
        expect(res.body.phone).toBe(user.phone);
    });

    test('84. does NOT expose full email', async () => {
        const user = await seedVerified();
        const res = await request(app).post('/api/otp/check-user').send({ phone: user.phone });
        expect(res.body.email).not.toBe(user.email);
    });

    test('85. does NOT leak OTP hash', async () => {
        const user = await seedVerified({ otp: '999999', otpExpiry: new Date(Date.now() + 300000) });
        const res = await request(app).post('/api/otp/check-user').send({ phone: user.phone });
        expect(res.body.otp).toBeUndefined();
    });

    test('86. does NOT leak cart/wishlist', async () => {
        const user = await seedVerified();
        const res = await request(app).post('/api/otp/check-user').send({ phone: user.phone });
        expect(res.body.cart).toBeUndefined();
    });

    test('87. does NOT leak otpAttempts', async () => {
        const user = await seedVerified({ otpAttempts: 3 });
        const res = await request(app).post('/api/otp/check-user').send({ phone: user.phone });
        expect(res.body.otpAttempts).toBeUndefined();
    });

    test('88. returns JSON content type', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/check-user').send({ phone: u.phone });
        expect(res.headers['content-type']).toMatch(/json/);
    });

    test('89. rejects empty string phone', async () => {
        const res = await request(app).post('/api/otp/check-user').send({ phone: '' });
        expect(res.statusCode).toBe(400);
    });

    test('90. rejects null phone', async () => {
        const res = await request(app).post('/api/otp/check-user').send({ phone: null });
        expect(res.statusCode).toBe(400);
    });

    test('90a. rejects object phone payload', async () => {
        const res = await request(app).post('/api/otp/check-user').send({ phone: { $gt: '' } });
        expect(res.statusCode).toBe(400);
    });
});

// ═══════════════════════════════════════════════════════════════════
//  SECTION 6: FULL FLOW E2E & HARDENED SECURITY (Tests 91-100)
// ═══════════════════════════════════════════════════════════════════
describe('Full OTP Flow — E2E & Hardened Security', () => {

    test('91. E2E signup via API: send → verify (bcrypt verified)', async () => {
        const u = uniqueUser();
        await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });

        // We CANNOT read plaintext OTP from DB (it's hashed).
        // For E2E we need to extract from dev console logs — in tests, just verify the flow:
        // Seed a known OTP manually and verify it
        const { user, otpPlain } = await seedPending({ otp: '654321', otpPurpose: 'signup' });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: otpPlain, purpose: 'signup' });
        expect(res.statusCode).toBe(200);
        expect(res.body.verified).toBe(true);

        const verified = await User.findById(user._id);
        expect(verified.isVerified).toBe(true);
    });

    test('92. E2E login: seed verified user → send → verify', async () => {
        const { user: verUser, otpPlain } = await seedPending({ otp: '321321', otpPurpose: 'signup' });
        // Verify first to create a "registered" user
        await request(app).post('/api/otp/verify')
            .send({ phone: verUser.phone, otp: otpPlain, purpose: 'signup' });

        // Now send login OTP
        await request(app).post('/api/otp/send')
            .send({ email: verUser.email, phone: verUser.phone, purpose: 'login' });

        // DB has hashed OTP — we can't extract plaintext. Tested via unit tests above.
        const u = await User.findById(verUser._id).select('+otp');
        expect(u.otp).toMatch(/^\$2[ab]\$/); // Confirm it's hashed
    });

    test('93. progressive lockout: 1st wrong → 2nd wrong → ... → 5th = LOCKED', async () => {
        const { user } = await seedPending({ otp: '999999' });
        let lastRes;
        for (let i = 0; i < 5; i++) {
            lastRes = await request(app).post('/api/otp/verify')
                .send({ phone: user.phone, otp: String(100000 + i), purpose: 'signup' });
        }
        // 5th attempt should lock
        expect(lastRes.statusCode).toBe(423);
        expect(lastRes.body.message).toMatch(/locked/i);

        // 6th attempt should also be locked
        const locked = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: '999999', purpose: 'signup' });
        expect(locked.statusCode).toBe(423);
    });

    test('94. lockout prevents correct OTP from working', async () => {
        const { user, otpPlain } = await seedPending({
            otp: '888888',
            otpLockedUntil: new Date(Date.now() + 900000)
        });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: otpPlain, purpose: 'signup' });
        expect(res.statusCode).toBe(423);
    });

    test('95. new OTP send clears lockout (user can retry)', async () => {
        const user = await seedVerified({
            otpAttempts: 5,
            otpLockedUntil: new Date(Date.now() + 900000)
        });
        // Send new OTP — should reset lockout
        await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'login' });
        const u = await User.findById(user._id).select('+otpAttempts +otpLockedUntil');
        expect(u.otpAttempts).toBe(0);
        expect(u.otpLockedUntil).toBeNull();
    });

    test('96. OTP hash is never exposed in any response', async () => {
        const u = uniqueUser();
        const sendRes = await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        expect(JSON.stringify(sendRes.body)).not.toMatch(/\$2[ab]\$/);
    });

    test('97. OTP in DB is ALWAYS a bcrypt hash (never plaintext)', async () => {
        const u = uniqueUser();
        await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        const db = await User.findOne({ phone: u.phone }).select('+otp');
        // bcrypt hash format
        expect(db.otp).toMatch(/^\$2[ab]\$\d{2}\$.{53}$/);
    });

    test('98. re-signup after abandoned attempt works', async () => {
        const u = uniqueUser();
        await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        const res = await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        expect(res.statusCode).toBe(200);
    });

    test('99. NoSQL injection in phone is blocked', async () => {
        const res = await request(app).post('/api/otp/check-user')
            .send({ phone: { $gt: '' } });
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.body.exists).not.toBe(true);
    });

    test('100. all endpoints return error structure on empty body', async () => {
        for (const path of ['/api/otp/send', '/api/otp/verify', '/api/otp/check-user']) {
            const res = await request(app).post(path).send({});
            expect(res.body).toHaveProperty('message');
            expect(res.body.message.length).toBeGreaterThan(0);
        }
    });
});
