jest.mock('../services/loyaltyService', () => ({
    awardLoyaltyPoints: jest.fn().mockResolvedValue(undefined),
    getRewardSnapshotFromUser: jest.fn().mockReturnValue({}),
}));

require('../index');

const User = require('../models/User');
const {
    buildSessionPayload,
    resolveAuthenticatedSession,
    syncAuthenticatedUser,
    applyLoginAssuranceToSession,
} = require('../services/authSessionService');
const { issueOtpFlowToken } = require('../utils/otpFlowToken');

let counter = 0;
const stamp = Date.now();

const uniqueEmail = (label) => {
    counter += 1;
    return `auth_session_${label}_${stamp}_${counter}@test.com`;
};

describe('authSessionService phone conflict guard', () => {
    test('blocks sync when the same real phone already exists under another account format', async () => {
        const newEmail = uniqueEmail('new');

        await User.create({
            name: 'Existing User',
            email: uniqueEmail('existing'),
            phone: '9876543210',
            isVerified: true,
        });

        await expect(syncAuthenticatedUser({
            authUser: {
                email: newEmail,
                emailVerified: true,
                displayName: 'New User',
            },
            email: newEmail,
            name: 'New User',
            phone: '+919876543210',
            awardLoginPoints: false,
        })).rejects.toMatchObject({
            message: 'Phone number is already linked to another account',
            statusCode: 409,
        });
    });
});

describe('authSessionService login assurance binding', () => {
    const originalOtpFlowSecret = process.env.OTP_FLOW_SECRET;

    beforeEach(() => {
        process.env.OTP_FLOW_SECRET = 'otp-flow-test-secret';
    });

    afterEach(() => {
        process.env.OTP_FLOW_SECRET = originalOtpFlowSecret;
    });

    test('binds password+otp assurance to the current Firebase auth_time', async () => {
        const user = await User.create({
            name: 'Verified User',
            email: uniqueEmail('assurance'),
            phone: '+919876543210',
            isVerified: true,
        });

        const { flowToken } = issueOtpFlowToken({
            userId: user._id,
            purpose: 'login',
            factor: 'otp',
        });

        await applyLoginAssuranceToSession({
            user,
            flowToken,
            authToken: { auth_time: 1712345678 },
            phone: '+919876543210',
        });

        const updated = await User.findById(user._id)
            .select('+authAssuranceAuthTime +loginOtpVerifiedAt +loginOtpAssuranceExpiresAt');

        expect(updated.authAssurance).toBe('password+otp');
        expect(updated.authAssuranceAuthTime).toBe(1712345678);
        expect(updated.loginOtpVerifiedAt).not.toBeNull();
        expect(updated.loginOtpAssuranceExpiresAt).not.toBeNull();
    });

    test('requires Firebase phone proof when the login flow token represents the email factor only', async () => {
        const user = await User.create({
            name: 'Verified User',
            email: uniqueEmail('email_factor'),
            phone: '+919876543210',
            isVerified: true,
        });

        const { flowToken } = issueOtpFlowToken({
            userId: user._id,
            purpose: 'login',
            factor: 'email',
        });

        await expect(applyLoginAssuranceToSession({
            user,
            flowToken,
            authToken: { auth_time: 1712345678 },
            phone: '+919876543210',
        })).rejects.toMatchObject({
            message: 'Firebase phone verification is required before completing secure sign-in.',
            statusCode: 403,
        });
    });
});

describe('authSessionService session intelligence payload', () => {
    test('includes assurance and acceleration intelligence in the session payload', () => {
        const payload = buildSessionPayload({
            authUser: {
                email: 'intel@example.com',
                displayName: 'Intel User',
                providerData: [{ providerId: 'password' }, { providerId: 'google.com' }],
                emailVerified: true,
                phoneNumber: '+919876543210',
            },
            authUid: 'uid-intel',
            user: {
                email: 'intel@example.com',
                phone: '+919876543210',
                isVerified: true,
                isAdmin: false,
                isSeller: true,
                accountState: 'active',
                authAssurance: 'password+otp',
                authAssuranceAt: new Date('2026-03-30T10:00:00.000Z'),
                loginOtpAssuranceExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
            },
        });

        expect(payload.intelligence).toMatchObject({
            assurance: {
                level: 'password+otp',
                label: 'Strong verification',
                isRecent: true,
            },
            readiness: {
                hasVerifiedEmail: true,
                hasPhone: true,
                accountState: 'active',
                isPrivileged: true,
            },
            acceleration: {
                suggestedRoute: 'social',
                rememberedIdentifier: 'email+phone',
                providerIds: ['password', 'google.com'],
            },
    });
  });
});

describe('authSessionService social identity fallback', () => {
    test('creates and resolves uid-backed social accounts when the provider omits email', async () => {
        const resolvedUser = await syncAuthenticatedUser({
            authUser: {
                uid: 'uid-x-no-email',
                email: '',
                emailVerified: false,
                displayName: 'X User',
            },
            email: '',
            name: 'X User',
            phone: '',
            awardLoginPoints: false,
        });

        expect(resolvedUser.email).toMatch(/@auth\.aura\.invalid$/);
        expect(resolvedUser.isVerified).toBe(true);

        const persistedUser = await User.findById(resolvedUser._id).lean();
        expect(persistedUser.authUid).toBe('uid-x-no-email');

        const session = await resolveAuthenticatedSession({
            authUser: {
                uid: 'uid-x-no-email',
                email: '',
                displayName: 'X User',
            },
            authUid: 'uid-x-no-email',
            authToken: {
                uid: 'uid-x-no-email',
                firebase: { sign_in_provider: 'twitter.com' },
            },
        });

        expect(session.user._id.toString()).toBe(resolvedUser._id.toString());
        expect(session.payload.profile.email).toBe('');
        expect(session.payload.session.email).toBe('');
    });

    test('allows trusted social providers to sync even when Firebase emailVerified is false', async () => {
        const providerEmail = uniqueEmail('x_unverified_email');

        const resolvedUser = await syncAuthenticatedUser({
            authUser: {
                uid: 'uid-x-with-email',
                email: providerEmail,
                emailVerified: false,
                displayName: 'X Verified By Provider',
                signInProvider: 'twitter.com',
                providerIds: ['twitter.com'],
            },
            email: providerEmail,
            name: 'X Verified By Provider',
            phone: '',
            awardLoginPoints: false,
        });

        expect(resolvedUser.email).toBe(providerEmail);
        expect(resolvedUser.isVerified).toBe(true);

        const persistedUser = await User.findById(resolvedUser._id).lean();
        expect(persistedUser.authUid).toBe('uid-x-with-email');
        expect(persistedUser.isVerified).toBe(true);
    });
});
