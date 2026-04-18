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

const scoreIdentityCandidate = (user = null, { email = '', authUid = '' } = {}) => {
    const publicEmail = isInternalAuthEmail(email) ? '' : normalizeEmail(email);
    const userEmail = normalizeEmail(user?.email);
    const userUid = normalizeUid(user?.authUid);
    const safeUid = normalizeUid(authUid);
    const loyaltyPoints = Number(user?.loyalty?.pointsBalance || 0);

    let score = 0;

    if (publicEmail && userEmail === publicEmail) {
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
    findPreferredIdentityUserLean,
    findPreferredIdentityUserDocument,
};
