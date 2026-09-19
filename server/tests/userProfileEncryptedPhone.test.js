process.env.FIELD_ENCRYPTION_ENABLED = 'true';
// Deterministic test-only key; master keys are rejected in production.
process.env.FIELD_ENCRYPTION_MASTER_KEY = 'user-profile-encrypted-phone-regression-key-0'; // nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret -- deterministic test-only key

jest.setTimeout(30000);

const User = require('../models/User');
const { decryptValue } = require('../models/utils/encryptedField');
const fieldEncryptionService = require('../services/fieldEncryptionService');
const { updateUserProfile } = require('../controllers/userController');

beforeAll(async () => {
    await fieldEncryptionService.primeFieldEncryption();
});

// Regression coverage for the encrypted-at-rest phone short-circuit inside
// requireFreshPhoneProofForProfileChange: .lean() reads bypass the encrypted
// field getter, so the stored phone must be decrypted before it is compared
// with the submitted one. Without the decrypt, re-submitting the current
// phone reads as a change and users get spurious 403s.
describe('updateUserProfile phone proof with encrypted phone at rest', () => {
    test('allows unchanged phone re-submission without fresh proof when stored phone is ciphertext', async () => {
        const user = await User.create({
            name: 'Encrypted Phone User',
            email: 'profile-encrypted-phone@test.com',
            phone: '9876500010',
            isAdmin: false,
            isVerified: true,
        });

        // Prove the fixture really is ciphertext at rest — if this ever fails,
        // the short-circuit assertion below would pass trivially on plaintext.
        const raw = await User.collection.findOne({ email: user.email });
        expect(String(raw.phone)).toMatch(/^v1\./);

        const req = {
            body: { phone: '+919876500010' },
            user: { email: user.email },
            authToken: {
                email: user.email,
                email_verified: true,
                auth_time: Math.floor(Date.now() / 1000) - 60,
            },
        };
        const res = { json: jest.fn() };
        const next = jest.fn();

        await updateUserProfile(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalled();

        const refreshed = await User.findById(user._id).lean();
        expect(String(decryptValue(refreshed.phone))).toContain('9876500010');
    });

    test('still requires fresh proof when the submitted phone actually changes', async () => {
        const user = await User.create({
            name: 'Encrypted Phone Change User',
            email: 'profile-encrypted-phone-change@test.com',
            phone: '9876500011',
            isAdmin: false,
            isVerified: true,
        });

        const req = {
            body: { phone: '+919876500099' },
            user: { email: user.email },
            authToken: {
                email: user.email,
                email_verified: true,
                auth_time: Math.floor(Date.now() / 1000) - 60,
            },
        };
        const res = { json: jest.fn() };
        const next = jest.fn();

        await updateUserProfile(req, res, next);

        expect(next).toHaveBeenCalled();
        const err = next.mock.calls[0][0];
        expect(err.statusCode).toBe(403);
        expect(err.message).toContain('Firebase phone verification is required');
        expect(res.json).not.toHaveBeenCalled();
    });
});
