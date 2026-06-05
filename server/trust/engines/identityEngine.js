const { normalizeActor } = require('../trustContext');

const evaluateIdentity = ({ actor = null, policy = {} } = {}) => {
    const normalizedActor = normalizeActor(actor);
    if (policy.requiresIdentity && !normalizedActor.isAuthenticated) {
        return {
            ok: false,
            reason: 'IDENTITY_REQUIRED',
            actor: normalizedActor,
        };
    }

    return {
        ok: true,
        reason: 'IDENTITY_OK',
        actor: normalizedActor,
    };
};

module.exports = {
    evaluateIdentity,
};
