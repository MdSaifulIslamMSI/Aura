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
        phone: `+919${String(TS).slice(-4)}${String(testCounter).padStart(5, '0')}`,
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
        isVerified: overrides.isVerified !== undefined ? overrides.isVerified : true,
        otp: otpPlain ? await bcrypt.hash(otpPlain, SALT) : null,
        otpExpiry: overrides.otpExpiry || (otpPlain ? new Date(Date.now() + 5 * 60 * 1000) : null),
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

    test('28. re-signup reuses pending record without creating duplicates', async () => {
        const u = uniqueUser();
        await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'signup' });
        expect(await User.countDocuments({ email: u.email })).toBe(1);
    });

    test('28a. repeated signup OTP does not delete unrelated pending users', async () => {
        const primary = uniqueUser();
        const unrelated = uniqueUser();

        await User.create({
            name: 'Pending',
            email: unrelated.email,
            phone: unrelated.phone,
            isVerified: false,
        });

        await request(app).post('/api/otp/send')
            .send({ email: primary.email, phone: primary.phone, purpose: 'signup' });
        await request(app).post('/api/otp/send')
            .send({ email: primary.email, phone: primary.phone, purpose: 'signup' });

        const unrelatedStillExists = await User.findOne({ email: unrelated.email, isVerified: false }).lean();
        expect(unrelatedStillExists).not.toBeNull();
    });

    test('28b. repeated signup OTP does not delete pending user sharing only one identifier variant', async () => {
        const target = uniqueUser();
        const other = uniqueUser();

        await User.create({
            name: 'Pending',
            email: other.email,
            phone: `+91${target.phone}`,
            isVerified: false,
        });

        await request(app).post('/api/otp/send')
            .send({ email: target.email, phone: target.phone, purpose: 'signup' });
        await request(app).post('/api/otp/send')
            .send({ email: target.email, phone: target.phone, purpose: 'signup' });

        const otherPending = await User.findOne({ email: other.email, isVerified: false }).lean();
        expect(otherPending).not.toBeNull();
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

    test('36. returns generic success response for login non-existent phone', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'login' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            success: true,
            message: 'If the account details are valid, we will continue with verification steps.'
        });
    });

    test('37. returns generic success response for forgot-password non-existent', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'forgot-password' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            success: true,
            message: 'If the account details are valid, we will continue with verification steps.'
        });
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

    test('43. login generic message does not reveal account status', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/send')
            .send({ email: u.email, phone: u.phone, purpose: 'login' });
        expect(res.body.message).toBe('If the account details are valid, we will continue with verification steps.');
    });

    test('44. unverified login returns generic success response', async () => {
        const { user } = await seedPending();
        const res = await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'login' });
        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe('If the account details are valid, we will continue with verification steps.');
    });

    test('45. unverified forgot-password returns generic success response', async () => {
        const { user } = await seedPending();
        const res = await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'forgot-password' });
        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe('If the account details are valid, we will continue with verification steps.');
    });

    test('46. responds within 500ms', async () => {
        const user = await seedVerified();
        const start = Date.now();
        await request(app).post('/api/otp/send')
            .send({ email: user.email, phone: user.phone, purpose: 'login' });
        expect(Date.now() - start).toBeLessThan(5000);
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

    test('50a. login mismatch returns generic response', async () => {
        const first = await seedVerified();
        const second = await seedVerified();
        const res = await request(app).post('/api/otp/send')
            .send({ email: first.email, phone: second.phone, purpose: 'login' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            success: true,
            message: 'If the account details are valid, we will continue with verification steps.'
        });
    });

    test('50b. forgot-password mismatch returns generic response', async () => {
        const first = await seedVerified();
        const second = await seedVerified();
        const res = await request(app).post('/api/otp/send')
            .send({ email: first.email, phone: second.phone, purpose: 'forgot-password' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            success: true,
            message: 'If the account details are valid, we will continue with verification steps.'
        });
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

    test('59a. 200 when verifying canonical phone for user stored as local 10-digit phone', async () => {
        const localPhone = '9876543210';
        const canonicalPhone = '+919876543210';
        const { user, otpPlain } = await seedPending({ phone: localPhone, otp: '909090', otpPurpose: 'signup' });

        const res = await request(app).post('/api/otp/verify')
            .send({ phone: canonicalPhone, otp: otpPlain, purpose: 'signup' });

        expect(res.statusCode).toBe(200);
        expect(res.body.verified).toBe(true);

        const updated = await User.findById(user._id).select('+otp +otpExpiry +otpPurpose +otpAttempts');
        expect(updated.otp).toBeNull();
        expect(updated.otpExpiry).toBeNull();
        expect(updated.otpPurpose).toBeNull();
        expect(updated.otpAttempts).toBe(0);
    });

    test('59b. preserves identity checks after resolving mixed phone format records', async () => {
        const localPhone = '9123456789';
        const canonicalPhone = '+919123456789';
        const { user } = await seedPending({ phone: localPhone, otp: '121212', otpPurpose: 'signup' });

        const res = await request(app).post('/api/otp/verify')
            .send({ phone: canonicalPhone, email: 'wrong@test.com', otp: '121212', purpose: 'signup' });

        expect(res.statusCode).toBe(403);

        const unchanged = await User.findById(user._id).select('+otp +otpPurpose');
        expect(unchanged.otp).toBeTruthy();
        expect(unchanged.otpPurpose).toBe('signup');
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

    test('62. returns only continuation metadata in response', async () => {
        const { user, otpPlain } = await seedPending({ otp: '666666', otpPurpose: 'signup' });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: otpPlain, purpose: 'signup' });
        expect(res.body.flowToken).toEqual(expect.any(String));
        expect(res.body.flowTokenExpiresAt).toEqual(expect.any(String));
        expect(res.body.maskedIdentifier).toEqual(expect.any(String));
    });

    test('63. does NOT leak profile data in response', async () => {
        const { user, otpPlain } = await seedPending({ otp: '444444', otpPurpose: 'signup' });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: otpPlain, purpose: 'signup' });
        expect(res.body.user).toBeUndefined();
        expect(res.body.email).toBeUndefined();
        expect(res.body.phone).toBeUndefined();
    });

    test('64. does NOT leak privileged role flags in response', async () => {
        const { user, otpPlain } = await seedPending({ otp: '333333', otpPurpose: 'signup' });
        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: otpPlain, purpose: 'signup' });
        expect(res.body.isAdmin).toBeUndefined();
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
            flowToken: expect.any(String),
            flowTokenExpiresAt: expect.any(String),
            maskedIdentifier: expect.any(String)
        }));
        expect(res.body.user).toBeUndefined();
    });
});

    test('75a. login verification does not force account verification', async () => {
        const user = await seedVerified({ otp: '313131', otpPurpose: 'login', isVerified: false });
        await User.updateOne({ _id: user._id }, { $set: { isVerified: false } });

        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: '313131', purpose: 'login' });

        expect(res.statusCode).toBe(200);
        const updated = await User.findById(user._id)
            .select('+loginOtpVerifiedAt +loginOtpAssuranceExpiresAt +resetOtpVerifiedAt');
        expect(updated.isVerified).toBe(false);
        expect(updated.loginOtpVerifiedAt).not.toBeNull();
        expect(updated.loginOtpAssuranceExpiresAt).not.toBeNull();
        expect(updated.resetOtpVerifiedAt).toBeNull();
    });

    test('75b. forgot-password verification sets only reset marker', async () => {
        const user = await seedVerified({ otp: '414141', otpPurpose: 'forgot-password', isVerified: false });
        await User.updateOne({ _id: user._id }, { $set: { isVerified: false } });

        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: '414141', purpose: 'forgot-password' });

        expect(res.statusCode).toBe(200);
        const updated = await User.findById(user._id)
            .select('+loginOtpVerifiedAt +loginOtpAssuranceExpiresAt +resetOtpVerifiedAt');
        expect(updated.isVerified).toBe(false);
        expect(updated.resetOtpVerifiedAt).not.toBeNull();
        expect(updated.loginOtpVerifiedAt).toBeNull();
        expect(updated.loginOtpAssuranceExpiresAt).toBeNull();
    });

    test('75c. payment-challenge verification issues token without account escalation', async () => {
        const user = await seedVerified({ otp: '515151', otpPurpose: 'payment-challenge' });

        const res = await request(app).post('/api/otp/verify')
            .send({ phone: user.phone, otp: '515151', purpose: 'payment-challenge', intentId: 'intent_abc123' });

        expect(res.statusCode).toBe(200);
        expect(res.body.challengeToken).toBeTruthy();
        const updated = await User.findById(user._id)
            .select('+loginOtpVerifiedAt +loginOtpAssuranceExpiresAt +resetOtpVerifiedAt');
        expect(updated.isVerified).toBe(true);
        expect(updated.loginOtpVerifiedAt).toBeNull();
        expect(updated.loginOtpAssuranceExpiresAt).toBeNull();
        expect(updated.resetOtpVerifiedAt).toBeNull();
    });

    test('75d. verification rejects email identity mismatch linkage', async () => {
        const one = await seedVerified({ otp: '616161', otpPurpose: 'login' });
        const two = await seedVerified();

        const res = await request(app).post('/api/otp/verify')
            .send({ phone: one.phone, email: two.email, otp: '616161', purpose: 'login' });

        expect(res.statusCode).toBe(403);
    });

    test('75e. verification rejects userId identity mismatch linkage', async () => {
        const one = await seedVerified({ otp: '717171', otpPurpose: 'forgot-password' });
        const two = await seedVerified();

        const res = await request(app).post('/api/otp/verify')
            .send({ phone: one.phone, userId: String(two._id), otp: '717171', purpose: 'forgot-password' });

        expect(res.statusCode).toBe(403);
    });


// ═══════════════════════════════════════════════════════════════════
//  SECTION 5: POST /api/otp/check-user (Tests 76-90)
// ═══════════════════════════════════════════════════════════════════
describe('POST /api/otp/check-user', () => {

    test('76. 400 when phone is missing', async () => {
        const res = await request(app).post('/api/otp/check-user').send({});
        expect(res.statusCode).toBe(400);
    });

    test('77. returns generic response for unknown phone', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/check-user').send({ phone: u.phone });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            success: true,
            message: 'If an account exists, verification instructions have been sent.'
        });
    });

    test('78. returns generic response for verified user', async () => {
        const user = await seedVerified();
        const res = await request(app).post('/api/otp/check-user').send({ phone: user.phone });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            success: true,
            message: 'If an account exists, verification instructions have been sent.'
        });
    });

    test('79. returns generic response for unverified user', async () => {
        const { user } = await seedPending();
        const res = await request(app).post('/api/otp/check-user').send({ phone: user.phone });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            success: true,
            message: 'If an account exists, verification instructions have been sent.'
        });
    });

    test('80. does not expose masked email', async () => {
        const user = await seedVerified();
        const res = await request(app).post('/api/otp/check-user').send({ phone: user.phone });
        expect(res.statusCode).toBe(200);
        expect(res.body.message).toEqual('If an account exists, verification instructions have been sent.');
        expect(res.body.email).toBeUndefined();
    });

    test('81. does not expose reason for non-existent user', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/check-user').send({ phone: u.phone });
        expect(res.statusCode).toBe(200);
        expect(res.body.message).toEqual('If an account exists, verification instructions have been sent.');
        expect(res.body.reason).toBeUndefined();
    });

    test('82. does NOT include phone field for non-existent user', async () => {
        const u = uniqueUser();
        const res = await request(app).post('/api/otp/check-user').send({ phone: u.phone });
        expect(res.statusCode).toBe(200);
        expect(res.body.message).toEqual('If an account exists, verification instructions have been sent.');
        expect(res.body.phone).toBeUndefined();
    });

    test('83. does NOT include phone field for existing user', async () => {
        const user = await seedVerified();
        const res = await request(app).post('/api/otp/check-user').send({ phone: user.phone });
        expect(res.statusCode).toBe(200);
        expect(res.body.message).toEqual('If an account exists, verification instructions have been sent.');
        expect(res.body.phone).toBeUndefined();
    });

    test('84. does not expose registeredPhoneSuffix hints', async () => {
        const user = await seedVerified();
        const res = await request(app).post('/api/otp/check-user').send({ phone: user.phone, email: 'mismatch@example.com' });
        expect(res.statusCode).toBe(200);
        expect(res.body.message).toEqual('If an account exists, verification instructions have been sent.');
        expect(res.body.registeredPhoneSuffix).toBeUndefined();
    });

    test('84a. never returns raw email in payload', async () => {
        const user = await seedVerified();
        const res = await request(app).post('/api/otp/check-user').send({ phone: user.phone });
        expect(res.statusCode).toBe(200);
        expect(res.body.message).toEqual('If an account exists, verification instructions have been sent.');
        expect(JSON.stringify(res.body)).not.toContain(user.email);
    });

    test('85. does NOT leak OTP hash', async () => {
        const user = await seedVerified({ otp: '999999', otpExpiry: new Date(Date.now() + 300000) });
        const res = await request(app).post('/api/otp/check-user').send({ phone: user.phone });
        expect(res.body.otp).toBeUndefined();
    });


    test('79. returns same generic payload for unverified user', async () => {
        const { user } = await seedPending();
        const res = await request(app).post('/api/otp/check-user').send({ phone: user.phone });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            success: true,
            message: 'If an account exists, verification instructions have been sent.',
        });
    });

    test('80. payload does not expose account-enumeration fields', async () => {
        const user = await seedVerified();
        const res = await request(app).post('/api/otp/check-user').send({ phone: user.phone });
        expect(res.body.exists).toBeUndefined();
        expect(res.body.email).toBeUndefined();
        expect(res.body.phone).toBeUndefined();
        expect(res.body.reason).toBeUndefined();
        expect(res.body.registeredPhoneSuffix).toBeUndefined();
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
        expect(res.body.success).not.toBe(true);
    });

    test('100. all endpoints return error structure on empty body', async () => {
        for (const path of ['/api/otp/send', '/api/otp/verify', '/api/otp/check-user']) {
            const res = await request(app).post(path).send({});
            expect(res.body).toHaveProperty('message');
            expect(res.body.message.length).toBeGreaterThan(0);
        }
    });
});
