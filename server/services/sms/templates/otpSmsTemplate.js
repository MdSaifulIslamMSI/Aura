const PURPOSE_META = {
    signup: {
        title: 'account signup',
    },
    login: {
        title: 'login verification',
    },
    'forgot-password': {
        title: 'password reset',
    },
    'payment-challenge': {
        title: 'payment challenge',
    },
};

const normalizePurpose = (purpose) => {
    const key = String(purpose || '').trim();
    return PURPOSE_META[key] ? key : 'login';
};

const renderOtpSmsTemplate = ({
    otp,
    purpose,
    context = {},
    brand = 'AURA',
    ttlMinutes = 5,
}) => {
    const resolvedPurpose = normalizePurpose(purpose);
    const code = String(otp || '').trim();
    const expiry = Number.isFinite(Number(ttlMinutes)) ? Number(ttlMinutes) : 5;
    const purposeTitle = PURPOSE_META[resolvedPurpose].title;
    const requestTime = String(context.requestTime || '-').trim();
    const deviceLabel = String(context.deviceLabel || 'Unknown device').trim();
    const maskedIp = String(context.maskedIp || 'Unavailable').trim();
    const locationLabel = String(context.locationLabel || 'Approximate location unavailable').trim();

    const body = [
        `${brand}: ${code} is your OTP for ${purposeTitle}.`,
        `Valid for ${expiry} min.`,
        `Request: ${requestTime}.`,
        `Device: ${deviceLabel}.`,
        `IP: ${maskedIp}.`,
        `Loc: ${locationLabel}.`,
        'Never share this OTP with anyone.',
        "If this wasn't you, reset password immediately.",
    ].join(' ');

    return {
        body,
    };
};

module.exports = {
    renderOtpSmsTemplate,
};
