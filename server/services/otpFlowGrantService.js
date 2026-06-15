const AppError = require('../utils/AppError');
const OtpFlowGrant = require('../models/OtpFlowGrant');

const normalizeText = (value, maxLength = 128) => String(value || '').trim().slice(0, maxLength);
const toExpiryDate = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new AppError('Login assurance token is invalid', 401);
    }
    return date;
};

const registerOtpFlowGrant = async ({
    tokenId = '',
    userId = '',
    purpose = '',
    factor = '',
    currentStep = 'issued',
    nextStep = '',
    expiresAt = null,
} = {}) => {
    const safeTokenId = normalizeText(tokenId, 128);
    const safePurpose = normalizeText(purpose, 64);
    const safeFactor = normalizeText(factor, 32);
    const safeCurrentStep = normalizeText(currentStep, 64) || 'issued';
    const safeNextStep = normalizeText(nextStep, 64);

    if (!safeTokenId || !userId || !safeNextStep) {
        return null;
    }

    const expiryDate = toExpiryDate(expiresAt);
    const now = new Date();

    await OtpFlowGrant.updateMany(
        {
            user: userId,
            purpose: safePurpose,
            nextStep: safeNextStep,
            state: 'active',
        },
        {
            $set: {
                state: 'superseded',
                supersededAt: now,
            },
        }
    );

    return OtpFlowGrant.create({
        tokenId: safeTokenId,
        user: userId,
        purpose: safePurpose,
        factor: safeFactor,
        currentStep: safeCurrentStep,
        nextStep: safeNextStep,
        expiresAt: expiryDate,
        issuedAt: now,
    });
};

const normalizeGrantIdentity = ({
    tokenId = '',
    userId = '',
    purpose = '',
    factor = '',
    nextStep = '',
} = {}) => ({
    safeTokenId: normalizeText(tokenId, 128),
    userId,
    safePurpose: normalizeText(purpose, 64),
    safeFactor: normalizeText(factor, 32),
    safeNextStep: normalizeText(nextStep, 64),
});

const buildGrantIdentityFilter = ({
    safeTokenId,
    userId,
    safePurpose,
    safeFactor,
    safeNextStep,
}) => ({
    tokenId: safeTokenId,
    user: userId,
    purpose: safePurpose,
    ...(safeFactor ? { factor: safeFactor } : {}),
    nextStep: safeNextStep,
});

const rejectUnavailableGrant = async ({
    safeTokenId,
    userId,
    safePurpose,
    safeFactor,
    safeNextStep,
}) => {
    const existing = await OtpFlowGrant.findOne({
        tokenId: safeTokenId,
        user: userId,
    }).lean();

    if (!existing) {
        throw new AppError('Login assurance token expired. Please verify OTP again.', 401);
    }
    if (existing.purpose !== safePurpose) {
        throw new AppError('Login assurance token purpose mismatch', 403);
    }
    if (safeFactor && existing.factor !== safeFactor) {
        throw new AppError('Login assurance token factor mismatch', 403);
    }
    if (existing.nextStep !== safeNextStep) {
        throw new AppError('Login assurance token next step mismatch', 403);
    }

    const expiryMs = new Date(existing.expiresAt).getTime();
    if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
        throw new AppError('Login assurance token expired. Please verify OTP again.', 401);
    }
    if (existing.state === 'superseded') {
        throw new AppError('Login assurance token was superseded. Please verify OTP again.', 409);
    }
    if (existing.state === 'reserved') {
        throw new AppError('Login assurance token is already being used. Please try again shortly.', 409);
    }
    if (existing.state === 'consumed') {
        throw new AppError('Login assurance token already used. Please verify OTP again.', 409);
    }

    throw new AppError('Login assurance token is invalid', 401);
};

const consumeOtpFlowGrant = async ({
    tokenId = '',
    userId = '',
    purpose = '',
    factor = '',
    nextStep = '',
} = {}) => {
    const identity = normalizeGrantIdentity({ tokenId, userId, purpose, factor, nextStep });
    const { safeTokenId, safePurpose, safeFactor, safeNextStep } = identity;
    const now = new Date();

    const grant = await OtpFlowGrant.findOneAndUpdate(
        {
            ...buildGrantIdentityFilter(identity),
            state: 'active',
            expiresAt: { $gt: now },
        },
        {
            $set: {
                state: 'consumed',
                consumedAt: now,
            },
        },
        {
            returnDocument: 'after',
        }
    );

    if (grant) {
        return grant;
    }

    return rejectUnavailableGrant({
        safeTokenId,
        userId,
        safePurpose,
        safeFactor,
        safeNextStep,
    });
};

const reserveOtpFlowGrant = async ({
    tokenId = '',
    userId = '',
    purpose = '',
    factor = '',
    nextStep = '',
} = {}) => {
    const identity = normalizeGrantIdentity({ tokenId, userId, purpose, factor, nextStep });
    const { safeTokenId, safePurpose, safeFactor, safeNextStep } = identity;
    const now = new Date();

    const grant = await OtpFlowGrant.findOneAndUpdate(
        {
            ...buildGrantIdentityFilter(identity),
            state: 'active',
            expiresAt: { $gt: now },
        },
        {
            $set: {
                state: 'reserved',
                reservedAt: now,
            },
            $unset: {
                consumedAt: '',
            },
        },
        {
            returnDocument: 'after',
        }
    );

    if (grant) {
        return grant;
    }

    return rejectUnavailableGrant({
        safeTokenId,
        userId,
        safePurpose,
        safeFactor,
        safeNextStep,
    });
};

const consumeReservedOtpFlowGrant = async ({
    tokenId = '',
    userId = '',
    purpose = '',
    factor = '',
    nextStep = '',
} = {}) => {
    const identity = normalizeGrantIdentity({ tokenId, userId, purpose, factor, nextStep });
    const now = new Date();

    const grant = await OtpFlowGrant.findOneAndUpdate(
        {
            ...buildGrantIdentityFilter(identity),
            state: 'reserved',
            expiresAt: { $gt: now },
        },
        {
            $set: {
                state: 'consumed',
                consumedAt: now,
            },
            $unset: {
                reservedAt: '',
            },
        },
        {
            returnDocument: 'after',
        }
    );

    if (grant) {
        return grant;
    }

    return rejectUnavailableGrant(identity);
};

const releaseReservedOtpFlowGrant = async ({
    tokenId = '',
    userId = '',
    purpose = '',
    factor = '',
    nextStep = '',
} = {}) => {
    const identity = normalizeGrantIdentity({ tokenId, userId, purpose, factor, nextStep });
    const now = new Date();

    return OtpFlowGrant.updateOne(
        {
            ...buildGrantIdentityFilter(identity),
            state: 'reserved',
            expiresAt: { $gt: now },
        },
        {
            $set: {
                state: 'active',
            },
            $unset: {
                reservedAt: '',
            },
        }
    );
};

module.exports = {
    registerOtpFlowGrant,
    consumeOtpFlowGrant,
    reserveOtpFlowGrant,
    consumeReservedOtpFlowGrant,
    releaseReservedOtpFlowGrant,
};
