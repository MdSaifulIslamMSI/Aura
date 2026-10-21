const User = require('../models/User');
const {
    buildIdentityQuery,
    isInternalAuthEmail,
    normalizeEmail,
    normalizeUid,
} = require('../utils/authIdentity');

const toTimestamp = (value) => {
    if (!value) return 0;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};

// SECURITY (CWE-290): an account already bound to a live foreign identity
// (public email + a different non-empty authUid) must never be re-selected
// by another identity through the email clause alone. Email-keyed
// selection stays valid only for unbound accounts (authUid absent) and
// internal-email stubs — the intended claiming shapes. Without this, a
// recycled/released verified email selects the stale account (score 1000
// beats the token holder's own authUid match, 400) across protect,
// session issuance and syncAuthenticatedUser.
const isEmailMatchSelectable = (user = null, { email = '', authUid = '' } = {}) => {
    const publicEmail = isInternalAuthEmail(email) ? '' : normalizeEmail(email);
    const userEmail = normalizeEmail(user?.email);
    const userUid = normalizeUid(user?.authUid);
    const safeUid = normalizeUid(authUid);

    return Boolean(publicEmail)
        && userEmail === publicEmail
        && !(safeUid && userUid && userUid !== safeUid && !isInternalAuthEmail(userEmail));
};

// SECURITY (CWE-290, BUG-R2-C2-A2-H2): scoring is not enough on its own —
// scoreIdentityCandidate still awards a foreign-bound account its base points,
// so a stale-email record stayed selectable whenever it was the ONLY candidate,
// which is the dominant shape (the attacker's identity never bootstraps a stub,
// because every contact resolves through the email clause). An account already
// bound to a different live identity is therefore removed from the candidate
// set outright. Only that identity's own token can reach it. Unbound accounts,
// internal-email stubs and accounts matching the token's own authUid are
// unaffected, so the intended claiming shapes still work.
const isSelectableIdentityCandidate = (user = null, identity = {}) => {
    const userUid = normalizeUid(user?.authUid);
    const tokenUid = normalizeUid(identity.authUid);

    if (!userUid || !tokenUid || userUid === tokenUid) {
        return true;
    }

    return isInternalAuthEmail(normalizeEmail(user?.email));
};

const scoreIdentityCandidate = (user = null, identity = {}) => {
    const { authUid = '' } = identity;
    const userEmail = normalizeEmail(user?.email);
    const userUid = normalizeUid(user?.authUid);
    const safeUid = normalizeUid(authUid);
    const loyaltyPoints = Number(user?.loyalty?.pointsBalance || 0);

    let score = 0;

    if (isEmailMatchSelectable(user, identity)) {
        score += 1000;
    }

    if (safeUid && userUid === safeUid) {
        score += 400;
    }

    if (userEmail && !isInternalAuthEmail(userEmail)) {
        score += 120;
    }

    if (Boolean(user?.isVerified)) {
        score += 20;
    }

    if (Boolean(user?.isAdmin)) {
        score += 20;
    }

    if (Boolean(user?.isSeller)) {
        score += 10;
    }

    if (Number.isFinite(loyaltyPoints) && loyaltyPoints > 0) {
        score += Math.min(loyaltyPoints, 100000) / 1000;
    }

    return {
        score,
        createdAt: toTimestamp(user?.createdAt),
    };
};

const selectPreferredIdentityUser = (users = [], identity = {}) => {
    if (!Array.isArray(users) || users.length === 0) {
        return null;
    }

    return [...users]
        .filter((user) => isSelectableIdentityCandidate(user, identity))
        .sort((left, right) => {
            const leftScore = scoreIdentityCandidate(left, identity);
            const rightScore = scoreIdentityCandidate(right, identity);

            if (rightScore.score !== leftScore.score) {
                return rightScore.score - leftScore.score;
            }

            return leftScore.createdAt - rightScore.createdAt;
        })[0] || null;
};

const findIdentityCandidatesLean = async ({ email = '', authUid = '', projection = null } = {}) => {
    const identityQuery = buildIdentityQuery({ email, authUid });
    if (!identityQuery) {
        return [];
    }

    return User.find(identityQuery, projection).lean();
};

const findIdentityCandidatesDocument = async ({ email = '', authUid = '', projection = null } = {}) => {
    const identityQuery = buildIdentityQuery({ email, authUid });
    if (!identityQuery) {
        return [];
    }

    return User.find(identityQuery, projection);
};

const findPreferredIdentityUserLean = async ({ email = '', authUid = '', projection = null } = {}) => {
    const candidates = await findIdentityCandidatesLean({ email, authUid, projection });
    return selectPreferredIdentityUser(candidates, { email, authUid });
};

const findPreferredIdentityUserDocument = async ({ email = '', authUid = '', projection = null } = {}) => {
    const candidates = await findIdentityCandidatesDocument({ email, authUid, projection });
    return selectPreferredIdentityUser(candidates, { email, authUid });
};

module.exports = {
    selectPreferredIdentityUser,
    isSelectableIdentityCandidate,
    findPreferredIdentityUserLean,
    findPreferredIdentityUserDocument,
};
