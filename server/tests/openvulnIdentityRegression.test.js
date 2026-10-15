/**
 * Regression coverage for the OpenVuln identity findings.
 *
 * Every case here fails if its fix is reverted. They are deliberately pure/unit
 * so they run cheaply and deterministically, and they pin the exact decision
 * each fix made rather than a surrounding happy path.
 */

const {
    selectPreferredIdentityUser,
    isSelectableIdentityCandidate,
} = require('../services/authIdentityResolutionService');
const {
    assertAdminPasskeyEnrollmentAssurance,
} = require('../controllers/mfaController');

const INTERNAL_EMAIL = 'YWRtaW5AZXRoLmF1cmEuaW52YWxpZA==@auth.aura.invalid';

describe('BUG-R2-C2-A2-H2 — stale/recycled verified email must not select a foreign account', () => {
    const victim = {
        _id: 'victim',
        email: 'recycled@example.test',
        authUid: 'uid-victim',
        isVerified: true,
        isAdmin: true,
        isSeller: true,
        createdAt: new Date('2020-01-01'),
    };

    test('rejects the account outright when it is the ONLY candidate', () => {
        // The dominant shape: the attacker's identity never bootstraps a stub,
        // so the email clause is the only one that matches. Down-ranking is not
        // enough — returning the top-scoring array entry hands over the account.
        const picked = selectPreferredIdentityUser([victim], {
            email: 'recycled@example.test',
            authUid: 'uid-attacker',
        });
        expect(picked).toBeNull();
    });

    test('the token holder selects their own account instead', () => {
        const attackerOwn = {
            _id: 'attacker',
            email: 'attacker@example.test',
            authUid: 'uid-attacker',
            isVerified: true,
            createdAt: new Date('2024-01-01'),
        };
        const picked = selectPreferredIdentityUser([victim, attackerOwn], {
            email: 'recycled@example.test',
            authUid: 'uid-attacker',
        });
        expect(picked._id).toBe('attacker');
    });

    test('the genuine owner still resolves their own account', () => {
        const picked = selectPreferredIdentityUser([victim], {
            email: 'recycled@example.test',
            authUid: 'uid-victim',
        });
        expect(picked._id).toBe('victim');
    });

    test('an UNBOUND account is still claimable by email (intended flow)', () => {
        const unboundStub = {
            _id: 'stub',
            email: 'newcomer@example.test',
            authUid: '',
            isVerified: false,
            createdAt: new Date('2024-01-01'),
        };
        const picked = selectPreferredIdentityUser([unboundStub], {
            email: 'newcomer@example.test',
            authUid: 'uid-newcomer',
        });
        expect(picked._id).toBe('stub');
    });

    test('an internal-email stub bound elsewhere is still claimable', () => {
        const stub = {
            _id: 'stub',
            email: INTERNAL_EMAIL,
            authUid: 'uid-other',
            isVerified: false,
            createdAt: new Date('2024-01-01'),
        };
        expect(isSelectableIdentityCandidate(stub, {
            email: INTERNAL_EMAIL,
            authUid: 'uid-newcomer',
        })).toBe(true);
    });

    test('a foreign-bound public-email account is not selectable', () => {
        expect(isSelectableIdentityCandidate(victim, {
            email: 'recycled@example.test',
            authUid: 'uid-attacker',
        })).toBe(false);
    });
});

describe('BUG-R2-C2-A4-H2 — passkey enrollment requires an independent factor for privileged roles', () => {
    const buildReq = (user, overrides = {}) => ({
        user,
        authToken: {
            auth_time: Math.floor(Date.now() / 1000),
            firebase: { sign_in_second_factor: overrides.secondFactor ?? 'webauthn' },
            amr: overrides.amr ?? [],
        },
        authSession: overrides.authSession ?? null,
    });

    test('rejects a synthetic webauthn sign_in_second_factor for an admin', () => {
        expect(() => assertAdminPasskeyEnrollmentAssurance(buildReq({ isAdmin: true })))
            .toThrow(/independent MFA/i);
    });

    test('rejects the same bypass for a SELLER (not just admins)', () => {
        // Sellers hold listing CRUD / mark-sold / escrow and sit at the
        // 'heightened' posture, so the gate must not be admin-only.
        expect(() => assertAdminPasskeyEnrollmentAssurance(buildReq({ isSeller: true })))
            .toThrow(/independent MFA/i);
    });

    test('rejects an arbitrary truthy second-factor string', () => {
        expect(() => assertAdminPasskeyEnrollmentAssurance(
            buildReq({ isAdmin: true }, { secondFactor: 'anything-goes' })
        )).toThrow(/independent MFA/i);
    });

    test('accepts a genuinely independent factor', () => {
        expect(() => assertAdminPasskeyEnrollmentAssurance(
            buildReq({ isAdmin: true }, { secondFactor: 'totp' })
        )).not.toThrow();
    });

    test('leaves plain buyer enrollment unenforced', () => {
        expect(() => assertAdminPasskeyEnrollmentAssurance(buildReq({ isSeller: false, isAdmin: false })))
            .not.toThrow();
    });
});