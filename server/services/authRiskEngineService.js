const RISK_LEVELS = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
};

const clampScore = (value) => Math.max(0, Math.min(100, Number(value) || 0));

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const normalizeIpRisk = (value = '') => safeString(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');

const userHasTrustedDevice = (user = {}, deviceId = '') => {
    const normalizedDeviceId = safeString(deviceId);
    if (!normalizedDeviceId || !Array.isArray(user?.trustedDevices)) return false;
    return user.trustedDevices.some((device) => safeString(device?.deviceId) === normalizedDeviceId);
};

const addSignal = (signals, signal) => {
    if (!signal?.reason) return;
    signals.push({
        reason: signal.reason,
        points: clampScore(signal.points),
        detail: safeString(signal.detail),
    });
};

const resolveLevel = (score) => {
    if (score >= 70) return RISK_LEVELS.HIGH;
    if (score >= 40) return RISK_LEVELS.MEDIUM;
    return RISK_LEVELS.LOW;
};

const evaluateLoginRisk = ({
    user = null,
    deviceId = '',
    recentFailureCount = 0,
    ipReputation = '',
    impossibleTravel = false,
    emailVerified = true,
    trustedDeviceRequired = false,
} = {}) => {
    const signals = [];
    const failures = Number(recentFailureCount || 0);
    const ipRisk = normalizeIpRisk(ipReputation);
    const hasKnownDevice = userHasTrustedDevice(user || {}, deviceId);
    const hasDeviceId = Boolean(safeString(deviceId));

    if (failures >= 10) {
        addSignal(signals, { reason: 'failed_login_velocity', points: 35, detail: '10_or_more_recent_failures' });
    } else if (failures >= 5) {
        addSignal(signals, { reason: 'failed_login_velocity', points: 24, detail: '5_or_more_recent_failures' });
    } else if (failures >= 3) {
        addSignal(signals, { reason: 'failed_login_velocity', points: 12, detail: '3_or_more_recent_failures' });
    }

    if (hasDeviceId && !hasKnownDevice) {
        addSignal(signals, { reason: 'new_device', points: trustedDeviceRequired ? 28 : 18, detail: 'device_not_in_trusted_set' });
    } else if (!hasDeviceId) {
        addSignal(signals, { reason: 'missing_device', points: trustedDeviceRequired ? 24 : 10, detail: 'no_device_identifier' });
    }

    if (['denylist', 'blocked', 'known_bad'].includes(ipRisk)) {
        addSignal(signals, { reason: 'ip_denylist', points: 70, detail: ipRisk });
    } else if (['watchlist', 'tor', 'proxy', 'vpn', 'datacenter'].includes(ipRisk)) {
        addSignal(signals, { reason: 'ip_watchlist', points: 25, detail: ipRisk });
    }

    if (impossibleTravel) {
        addSignal(signals, { reason: 'impossible_travel', points: 40, detail: 'geo_velocity_placeholder' });
    }

    if (emailVerified === false) {
        addSignal(signals, { reason: 'unverified_email', points: 12, detail: 'email_not_verified' });
    }

    const score = clampScore(signals.reduce((sum, signal) => sum + signal.points, 0));
    const level = resolveLevel(score);
    const reasons = signals.map((signal) => signal.reason);
    const requireStepUp = score >= 40
        || reasons.includes('new_device')
        || reasons.includes('impossible_travel')
        || reasons.includes('ip_watchlist');
    const block = reasons.includes('ip_denylist');

    return {
        score,
        level,
        reasons,
        signals,
        requireStepUp,
        block,
        knownDevice: hasKnownDevice,
    };
};

module.exports = {
    RISK_LEVELS,
    evaluateLoginRisk,
};
