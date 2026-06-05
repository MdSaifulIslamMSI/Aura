const normalizeText = (value = '') => String(value || '').trim().toLowerCase();

const STEP_UP_WINDOWS_MS = Object.freeze({
    MFA: 10 * 60 * 1000,
    PASSKEY: 5 * 60 * 1000,
});

const getSessionStepUpUntil = (session = {}) => {
    const raw = session?.stepUpUntil || session?.freshMfaUntil || session?.mfaVerifiedUntil || null;
    const timestamp = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
};

const getActorRecentMfaAt = (actor = {}) => {
    const raw = actor?.mfa?.lastMfaAt || actor?.authAssuranceAt || actor?.lastMfaAt || null;
    const timestamp = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
};

const sessionHasPasskey = (session = {}) => {
    const amr = Array.isArray(session?.amr)
        ? session.amr.map(normalizeText)
        : [];
    return Boolean(
        session?.passkeyVerified
        || session?.webauthnVerified
        || normalizeText(session?.stepUpMethod) === 'passkey'
        || normalizeText(session?.freshMfaMethod) === 'passkey'
        || amr.includes('passkey')
        || amr.includes('webauthn')
    );
};

const hasFreshStepUp = ({
    actor = {},
    session = {},
    requiredStepUp = null,
    now = Date.now(),
} = {}) => {
    if (!requiredStepUp) return true;
    const required = String(requiredStepUp || '').trim().toUpperCase();
    const windowMs = STEP_UP_WINDOWS_MS[required] || STEP_UP_WINDOWS_MS.MFA;
    const stepUpUntil = getSessionStepUpUntil(session);
    const activeSessionStepUp = stepUpUntil > now;

    if (required === 'PASSKEY') {
        return Boolean(activeSessionStepUp && sessionHasPasskey(session));
    }

    const actorMfaAt = getActorRecentMfaAt(actor);
    const recentActorMfa = actorMfaAt > 0 && (now - actorMfaAt) <= windowMs;
    return Boolean(activeSessionStepUp || recentActorMfa || session?.freshMfaSatisfied);
};

const evaluateSensitiveAction = ({
    actor = {},
    session = {},
    policy = {},
    now = Date.now(),
} = {}) => {
    if (!policy.sensitive || !policy.stepUp) {
        return {
            ok: true,
            reason: 'STEP_UP_NOT_REQUIRED',
            requiredStepUp: null,
        };
    }

    const satisfied = hasFreshStepUp({
        actor,
        session,
        requiredStepUp: policy.stepUp,
        now,
    });

    return {
        ok: satisfied,
        reason: satisfied ? 'STEP_UP_SATISFIED' : 'STEP_UP_REQUIRED',
        requiredStepUp: policy.stepUp,
    };
};

module.exports = {
    STEP_UP_WINDOWS_MS,
    evaluateSensitiveAction,
    hasFreshStepUp,
};
