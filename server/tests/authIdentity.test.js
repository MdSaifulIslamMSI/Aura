const {
    isTrustedSocialProvider,
    resolveEmailVerifiedState,
} = require('../utils/authIdentity');
const { selectPreferredIdentityUser } = require('../services/authIdentityResolutionService');

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

    test('never selects an account already bound to another live identity by email alone', () => {
        const staleEmailOwner = {
            _id: 'victim',
            email: 'recycled@example.test',
            authUid: 'uid-victim',
            isVerified: true,
            createdAt: '2020-01-01T00:00:00.000Z',
        };
        const attackerOwnAccount = {
            _id: 'attacker',
            email: 'attacker@example.test',
            authUid: 'uid-attacker',
            isVerified: true,
            createdAt: '2021-01-01T00:00:00.000Z',
        };

        expect(selectPreferredIdentityUser(
            [staleEmailOwner, attackerOwnAccount],
            { email: 'recycled@example.test', authUid: 'uid-attacker' }
        )).toBe(attackerOwnAccount);

        // The intended claiming shapes still resolve to the email-keyed
        // account: an unbound record and an internal-email stub.
        expect(selectPreferredIdentityUser(
            [{ ...staleEmailOwner, authUid: '' }, attackerOwnAccount],
            { email: 'recycled@example.test', authUid: 'uid-attacker' }
        )).toMatchObject({ _id: 'victim' });
    });
});
