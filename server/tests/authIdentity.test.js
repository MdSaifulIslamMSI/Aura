const {
    isTrustedSocialProvider,
    resolveEmailVerifiedState,
} = require('../utils/authIdentity');

describe('auth identity trust boundaries', () => {
    test('matches only exact trusted social provider ids', () => {
        expect(isTrustedSocialProvider('google.com')).toBe(true);
        expect(isTrustedSocialProvider('TWITTER.COM')).toBe(true);
        expect(isTrustedSocialProvider('notgoogle.example')).toBe(false);
        expect(isTrustedSocialProvider('github.com.attacker.example')).toBe(false);
        expect(isTrustedSocialProvider('attacker-twitter.com')).toBe(false);
    });

    test('never overrides an explicit unverified-email claim', () => {
        expect(resolveEmailVerifiedState({
            authUser: {
                uid: 'uid-social-unverified',
                email: 'unverified@example.test',
                emailVerified: false,
                providerIds: ['twitter.com'],
            },
            user: {
                email: 'unverified@example.test',
                isVerified: true,
            },
        })).toBe(false);
    });

    test('does not infer email verification when claims are absent', () => {
        expect(resolveEmailVerifiedState({
            authUser: {
                uid: 'uid-social-no-claim',
                providerIds: ['twitter.com'],
            },
        })).toBe(false);
    });
});
