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
const { registerOtpFlowGrant } = require('../services/otpFlowGrantService');

let counter = 0;
const stamp = Date.now();

const uniqueEmail = (label) => {
    counter += 1;
    return `auth_session_${label}_${stamp}_${counter}@test.com`;
};

const buildRuntimeSecret = (label = 'secret') => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

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
        process.env.OTP_FLOW_SECRET = buildRuntimeSecret('otp-flow');
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

        const { flowToken, flowTokenExpiresAt, tokenState } = issueOtpFlowToken({
            userId: user._id,
            purpose: 'login',
            factor: 'otp',
        });
        await registerOtpFlowGrant({
            tokenId: tokenState.tokenId,
            userId: user._id,
            purpose: 'login',
            factor: 'otp',
            currentStep: 'otp-verified',
            nextStep: tokenState.nextStep,
            expiresAt: flowTokenExpiresAt,
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

        const { flowToken, flowTokenExpiresAt, tokenState } = issueOtpFlowToken({
            userId: user._id,
            purpose: 'login',
            factor: 'email',
        });
        await registerOtpFlowGrant({
            tokenId: tokenState.tokenId,
            userId: user._id,
            purpose: 'login',
            factor: 'email',
            currentStep: 'email-verified',
            nextStep: tokenState.nextStep,
            expiresAt: flowTokenExpiresAt,
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

    test('rejects replay when the same login assurance token is consumed twice', async () => {
        const user = await User.create({
            name: 'Replay Guard',
            email: uniqueEmail('replay_guard'),
            phone: '+919812341234',
            isVerified: true,
        });

        const { flowToken, flowTokenExpiresAt, tokenState } = issueOtpFlowToken({
            userId: user._id,
            purpose: 'login',
            factor: 'otp',
        });
        await registerOtpFlowGrant({
            tokenId: tokenState.tokenId,
            userId: user._id,
            purpose: 'login',
            factor: 'otp',
            currentStep: 'otp-verified',
            nextStep: tokenState.nextStep,
            expiresAt: flowTokenExpiresAt,
        });

        await applyLoginAssuranceToSession({
            user,
            flowToken,
            authToken: { auth_time: 1712345678 },
            phone: '+919812341234',
        });

        await expect(applyLoginAssuranceToSession({
            user,
            flowToken,
            authToken: { auth_time: 1712345678 },
            phone: '+919812341234',
        })).rejects.toMatchObject({
            message: 'Login assurance token already used. Please verify OTP again.',
            statusCode: 409,
        });
    });

    test('requires the same trusted device session proof when login assurance is device-session bonded', async () => {
        const user = await User.create({
            name: 'Session Bond User',
            email: uniqueEmail('session_bond'),
            phone: '+919834561234',
            isVerified: true,
        });

        const { flowToken, flowTokenExpiresAt, tokenState } = issueOtpFlowToken({
            userId: user._id,
            purpose: 'login',
            factor: 'otp',
            signalBond: {
                deviceId: 'device-123',
                deviceSessionHash: 'session-hash-123',
            },
        });
        await registerOtpFlowGrant({
            tokenId: tokenState.tokenId,
            userId: user._id,
            purpose: 'login',
            factor: 'otp',
            currentStep: 'otp-verified',
            nextStep: tokenState.nextStep,
            expiresAt: flowTokenExpiresAt,
        });

        await expect(applyLoginAssuranceToSession({
            user,
            flowToken,
            authToken: { auth_time: 1712345678 },
            deviceId: 'device-123',
            deviceSessionHash: 'session-hash-other',
            phone: '+919834561234',
        })).rejects.toMatchObject({
            message: 'Login assurance token trusted device session mismatch',
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
            posture: {
                trustedDeviceBound: false,
                cryptoDeviceBound: false,
                session: {
                    freshForSensitiveActions: false,
                },
                policy: {
                    privilegedAccount: true,
                    elevatedAssurance: true,
                    sensitiveActionsAllowed: false,
                },
            },
        });
    });

    test('treats an active trusted-device step-up as fresh for sensitive-action intelligence', () => {
        const payload = buildSessionPayload({
            authUser: {
                email: 'stepup@example.com',
                displayName: 'Step Up Admin',
                providerData: [{ providerId: 'password' }],
                emailVerified: true,
            },
            authUid: 'uid-stepup',
            authSession: {
                sessionId: 'session-stepup',
                firebaseUid: 'uid-stepup',
                email: 'stepup@example.com',
                emailVerified: true,
                displayName: 'Step Up Admin',
                providerIds: ['password'],
                authTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                issuedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                firebaseExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                aal: 'aal2',
                amr: ['password', 'trusted_device'],
                deviceId: 'device-stepup-1',
                deviceMethod: 'browser_key',
                riskState: 'privileged',
                stepUpUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            },
            user: {
                email: 'stepup@example.com',
                phone: '',
                isVerified: true,
                isAdmin: true,
                isSeller: false,
                accountState: 'active',
                authAssurance: 'none',
            },
        });

        expect(payload.intelligence.posture).toMatchObject({
            continuousAccess: true,
            trustedDeviceBound: true,
            session: {
                freshForSensitiveActions: true,
                stepUpActive: true,
            },
            policy: {
                elevatedAssurance: true,
                sensitiveActionsAllowed: true,
                reauthRecommended: false,
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

    test('builds authenticated session payloads with verified email for trusted social providers', () => {
        const payload = buildSessionPayload({
            authUser: {
                uid: 'uid-x-admin',
                email: 'x-admin@example.com',
                emailVerified: false,
                displayName: 'X Admin',
                signInProvider: 'twitter.com',
                providerIds: ['twitter.com'],
            },
            authUid: 'uid-x-admin',
            authToken: {
                email: 'x-admin@example.com',
                email_verified: false,
                firebase: { sign_in_provider: 'twitter.com' },
            },
            user: {
                _id: 'user-x-admin',
                email: 'x-admin@example.com',
                phone: '',
                isVerified: true,
                isAdmin: true,
                isSeller: false,
                accountState: 'active',
                moderation: {},
                loyalty: {},
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
        });

        expect(payload.session.emailVerified).toBe(true);
        expect(payload.roles.isVerified).toBe(true);
        expect(payload.intelligence.readiness.hasVerifiedEmail).toBe(true);
    });

    test('prefers the canonical public-email profile over a stale authUid placeholder during social sync', async () => {
        const publicEmail = uniqueEmail('social_split');

        const placeholderUser = await User.create({
            name: 'Placeholder User',
            authUid: 'uid-social-split',
            email: 'dWlkLXNvY2lhbC1zcGxpdA@auth.aura.invalid',
            isVerified: true,
            loyalty: { pointsBalance: 0 },
        });

        const canonicalUser = await User.create({
            name: 'Canonical Admin',
            email: publicEmail,
            isAdmin: true,
            isVerified: true,
            loyalty: { pointsBalance: 1808, lifetimeEarned: 1808 },
        });

        const resolvedUser = await syncAuthenticatedUser({
            authUser: {
                uid: 'uid-social-split',
                email: publicEmail,
                emailVerified: false,
                displayName: 'Canonical Admin',
                signInProvider: 'twitter.com',
                providerIds: ['twitter.com'],
            },
            email: publicEmail,
            name: 'Canonical Admin',
            phone: '',
            awardLoginPoints: false,
        });

        const refreshedCanonicalUser = await User.findById(canonicalUser._id).lean();
        const refreshedPlaceholderUser = await User.findById(placeholderUser._id).lean();

        expect(resolvedUser._id.toString()).toBe(canonicalUser._id.toString());
        expect(refreshedCanonicalUser.authUid).toBe('uid-social-split');
        expect(refreshedCanonicalUser.isAdmin).toBe(true);
        expect(refreshedCanonicalUser.loyalty.pointsBalance).toBe(1808);
        expect(refreshedPlaceholderUser.authUid).toBeUndefined();
    });

    test('resolves authenticated sessions against the canonical public-email profile when a placeholder also exists', async () => {
        const publicEmail = uniqueEmail('session_split');

        await User.create({
            name: 'Placeholder User',
            authUid: 'uid-session-split',
            email: 'dWlkLXNlc3Npb24tc3BsaXQ@auth.aura.invalid',
            isVerified: true,
            loyalty: { pointsBalance: 0 },
        });

        const canonicalUser = await User.create({
            name: 'Canonical Admin',
            email: publicEmail,
            isAdmin: true,
            isVerified: true,
            loyalty: { pointsBalance: 1808, lifetimeEarned: 1808 },
        });

        const session = await resolveAuthenticatedSession({
            authUser: {
                uid: 'uid-session-split',
                email: publicEmail,
                emailVerified: false,
                displayName: 'Canonical Admin',
                signInProvider: 'twitter.com',
                providerIds: ['twitter.com'],
            },
            authUid: 'uid-session-split',
            authToken: {
                uid: 'uid-session-split',
                email: publicEmail,
                email_verified: false,
                firebase: { sign_in_provider: 'twitter.com' },
            },
        });

        expect(session.user._id.toString()).toBe(canonicalUser._id.toString());
        expect(session.user.isAdmin).toBe(true);
        expect(session.payload.profile.email).toBe(publicEmail);
        expect(session.payload.roles.isAdmin).toBe(true);
    });
});
