const crypto = require('crypto');
const AdminRecoveryGrant = require('../models/AdminRecoveryGrant');
const AdminSecurityAuditLog = require('../models/AdminSecurityAuditLog');
const { resolveAdminSecurityConfig } = require('../config/adminSecurityConfig');

const normalize = (value) => String(value || '').trim();

const hmacSecurityValue = (value, secret = resolveAdminSecurityConfig().hashSecret) => {
    const normalized = normalize(value);
    if (!normalized || !secret) return '';
    return crypto.createHmac('sha256', secret).update(normalized).digest('hex');
};

const createOpaqueSecret = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

const buildRateLimitKey = (scope, req = {}) => {
    const principal = normalize(req.user?._id || req.authUid || 'anonymous');
    const network = normalize(req.ip || req.socket?.remoteAddress || 'unknown');
    return hmacSecurityValue(`${scope}:${principal}:${network}`) || 'unconfigured';
};

const recordAdminSecurityAudit = async ({
    event,
    outcome,
    reasonCode = '',
    subjectUser = null,
    grantId = '',
    req = null,
    metadata = {},
    mongoSession = null,
} = {}) => {
    const record = {
        event: normalize(event),
        outcome: normalize(outcome),
        reasonCode: normalize(reasonCode),
        subjectUser: subjectUser || null,
        grantId: normalize(grantId),
        requestId: normalize(req?.requestId || req?.headers?.['x-request-id']),
        ipHash: hmacSecurityValue(req?.ip || req?.socket?.remoteAddress || ''),
        userAgentHash: hmacSecurityValue(req?.headers?.['user-agent'] || ''),
        metadata,
    };
    if (!mongoSession) return AdminSecurityAuditLog.create(record);
    const [created] = await AdminSecurityAuditLog.create([record], { session: mongoSession });
    return created;
};

const createAdminRecoveryGrant = async ({
    user,
    operator,
    secondOperator = '',
    ticket = '',
    reasonCode,
    expiresInSeconds,
    model = AdminRecoveryGrant,
} = {}) => {
    const config = resolveAdminSecurityConfig();
    const operatorHash = hmacSecurityValue(operator);
    const secondOperatorHash = hmacSecurityValue(secondOperator);
    if (config.twoPersonRecoveryRequired && (!secondOperatorHash || secondOperatorHash === operatorHash)) {
        throw new Error('A distinct second recovery operator is required by policy');
    }
    const plaintextToken = createOpaqueSecret(32);
    const grantId = crypto.randomUUID();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + (Number(expiresInSeconds || config.recoveryGrantTtlSeconds) * 1000));
    await model.updateMany(
        {
            subjectUser: user?._id,
            state: 'active',
        },
        {
            $set: {
                state: 'revoked',
                revokedAt: issuedAt,
            },
            $unset: {
                authorityHash: '',
                boundSessionHash: '',
                authorityExpiresAt: '',
            },
        }
    );
    const record = await model.create({
        grantId,
        tokenHash: hmacSecurityValue(plaintextToken),
        subjectUser: user?._id,
        subjectAuthUidHash: hmacSecurityValue(user?.authUid || ''),
        allowedMethods: ['passkey'],
        adminSecurityVersion: Number(user?.adminSecurityVersion || 0),
        operatorHash,
        secondOperatorHash,
        ticketHash: hmacSecurityValue(ticket),
        reasonCode: normalize(reasonCode),
        issuedAt,
        expiresAt,
    });
    return { grant: record, plaintextToken };
};

const exchangeAdminRecoveryGrant = async ({
    plaintextToken,
    user,
    sessionId,
    model = AdminRecoveryGrant,
    now = new Date(),
} = {}) => {
    const config = resolveAdminSecurityConfig();
    const authority = createOpaqueSecret(32);
    const authorityExpiresAt = new Date(now.getTime() + (config.recoveryAuthorityTtlSeconds * 1000));
    const grant = await model.findOneAndUpdate(
        {
            tokenHash: hmacSecurityValue(plaintextToken),
            subjectUser: user?._id,
            adminSecurityVersion: Number(user?.adminSecurityVersion || 0),
            state: 'active',
            expiresAt: { $gt: now },
        },
        {
            $set: {
                state: 'exchanged',
                exchangedAt: now,
                boundSessionHash: hmacSecurityValue(sessionId),
                authorityHash: hmacSecurityValue(authority),
                authorityExpiresAt,
            },
        },
        { returnDocument: 'after' }
    ).select('+authorityHash +boundSessionHash');

    if (!grant) return null;
    return { grant, authority, authorityExpiresAt };
};

const getActiveRecoveryAuthority = async ({
    authority,
    user,
    sessionId,
    model = AdminRecoveryGrant,
    now = new Date(),
} = {}) => {
    if (!authority || !user?._id || !sessionId) return null;
    return model.findOne({
        authorityHash: hmacSecurityValue(authority),
        boundSessionHash: hmacSecurityValue(sessionId),
        subjectUser: user._id,
        adminSecurityVersion: Number(user.adminSecurityVersion || 0),
        state: { $in: ['exchanged', 'consuming'] },
        expiresAt: { $gt: now },
        authorityExpiresAt: { $gt: now },
    }).select('+authorityHash +boundSessionHash');
};

const reserveRecoveryGrant = async ({ grantId, user, model = AdminRecoveryGrant, now = new Date() } = {}) => (
    model.findOneAndUpdate(
        {
            grantId,
            subjectUser: user?._id,
            adminSecurityVersion: Number(user?.adminSecurityVersion || 0),
            state: 'exchanged',
            expiresAt: { $gt: now },
            authorityExpiresAt: { $gt: now },
        },
        { $set: { state: 'consuming', consumingAt: now } },
        { returnDocument: 'after' }
    )
);

const releaseReservedRecoveryGrant = async ({ grantId, model = AdminRecoveryGrant } = {}) => (
    model.updateOne(
        { grantId, state: 'consuming' },
        { $set: { state: 'exchanged', consumingAt: null } }
    )
);

const revokeRecoveryGrant = async ({ grantId, user = null, model = AdminRecoveryGrant, now = new Date() } = {}) => {
    const filter = {
        grantId,
        state: { $in: ['active', 'exchanged', 'consuming'] },
    };
    if (user?._id) filter.subjectUser = user._id;
    return model.updateOne(
        filter,
        {
            $set: { state: 'revoked', revokedAt: now },
            $unset: {
                authorityHash: '',
                boundSessionHash: '',
                authorityExpiresAt: '',
            },
        }
    );
};

const consumeReservedRecoveryGrant = async ({
    grantId,
    user,
    mongoSession = null,
    model = AdminRecoveryGrant,
    now = new Date(),
} = {}) => model.findOneAndUpdate(
    {
        grantId,
        subjectUser: user?._id,
        adminSecurityVersion: Number(user?.adminSecurityVersion || 0),
        state: 'consuming',
    },
    {
        $set: {
            state: 'consumed',
            consumedAt: now,
        },
        $unset: {
            authorityHash: '',
            boundSessionHash: '',
            authorityExpiresAt: '',
        },
    },
    { returnDocument: 'after', session: mongoSession || undefined }
);

module.exports = {
    buildRateLimitKey,
    consumeReservedRecoveryGrant,
    createAdminRecoveryGrant,
    createOpaqueSecret,
    exchangeAdminRecoveryGrant,
    getActiveRecoveryAuthority,
    hmacSecurityValue,
    recordAdminSecurityAudit,
    releaseReservedRecoveryGrant,
    reserveRecoveryGrant,
    revokeRecoveryGrant,
};
