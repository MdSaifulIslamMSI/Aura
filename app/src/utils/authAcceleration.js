const AUTH_JOURNEY_STORAGE_KEY = 'aura_auth_journey_v1';
const AUTH_IDENTITY_MEMORY_KEY = 'aura_auth_identity_memory_v1';
const AUTH_JOURNEY_TTL_MS = 15 * 60 * 1000;
const AUTH_IDENTITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const AUTH_MODES = new Set(['signin', 'signup', 'forgot-password']);
const AUTH_STEPS = new Set(['form', 'otp', 'reset-password']);
const OTP_STAGES = new Set(['single', 'email', 'phone']);
const OTP_TRANSPORTS = new Set(['backend_otp', 'firebase_sms']);

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const normalizePhone = (value) => (
    typeof value === 'string' ? value.trim().replace(/[\s\-()]/g, '') : ''
);

const safeParse = (value) => {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const getStorage = (kind) => {
    if (typeof window === 'undefined') return null;
    try {
        return kind === 'session' ? window.sessionStorage : window.localStorage;
    } catch {
        return null;
    }
};

const purgeIfExpired = (storage, key, ttlMs) => {
    if (!storage) return null;
    const parsed = safeParse(storage.getItem(key));
    if (!parsed || typeof parsed !== 'object') {
        storage.removeItem(key);
        return null;
    }

    const savedAt = Number(parsed.savedAt || 0);
    if (!Number.isFinite(savedAt) || savedAt <= 0 || (Date.now() - savedAt) > ttlMs) {
        storage.removeItem(key);
        return null;
    }

    return parsed;
};

const formatRelativeAge = (timestamp) => {
    const value = Number(timestamp || 0);
    if (!Number.isFinite(value) || value <= 0) return '';

    const elapsedMs = Math.max(0, Date.now() - value);
    const seconds = Math.round(elapsedMs / 1000);
    if (seconds < 60) return 'just now';

    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.round(hours / 24);
    return `${days}d ago`;
};

const resolveMode = (value, fallback = 'signin') => {
    const nextMode = normalizeText(value);
    return AUTH_MODES.has(nextMode) ? nextMode : fallback;
};

const resolveStep = (value, fallback = 'form') => {
    const nextStep = normalizeText(value);
    return AUTH_STEPS.has(nextStep) ? nextStep : fallback;
};

const resolveOtpStage = (value, fallback = 'single') => {
    const nextStage = normalizeText(value);
    return OTP_STAGES.has(nextStage) ? nextStage : fallback;
};

const resolveOtpTransport = (value, fallback = 'backend_otp') => {
    const nextTransport = normalizeText(value);
    return OTP_TRANSPORTS.has(nextTransport) ? nextTransport : fallback;
};

export const maskEmail = (value) => {
    const safeEmail = normalizeEmail(value);
    if (!safeEmail || !safeEmail.includes('@')) return '';

    const [localPart, domain] = safeEmail.split('@');
    if (!localPart || !domain) return safeEmail;

    if (localPart.length <= 2) {
        return `${localPart[0] || '*'}*@${domain}`;
    }

    return `${localPart.slice(0, 2)}***@${domain}`;
};

export const maskPhone = (value) => {
    const digits = normalizePhone(value);
    if (!digits) return '';

    const suffix = digits.slice(-4);
    return digits.startsWith('+')
        ? `***${suffix}`
        : `•••${suffix}`;
};

const canResumeOtpStep = ({ mode, step, otpStage, otpTransport }) => (
    step === 'otp'
    && mode !== 'signin'
    && otpStage === 'single'
    && otpTransport === 'backend_otp'
);

const buildResumeMessage = ({ canResumeOtp, mode }) => {
    if (canResumeOtp) {
        return {
            title: 'Verification ready',
            detail: mode === 'signup'
                ? 'Your account activation OTP window is still open.'
                : 'Your recovery OTP window is still open.',
        };
    }

    return {
        title: 'Fast recovery ready',
        detail: mode === 'signin'
            ? 'We restored your identity details. Re-enter your password to restart the secure sign-in lane.'
            : 'We restored your identity details so you can restart the secure flow without typing everything again.',
    };
};

export const readAuthJourneyDraft = () => {
    const storage = getStorage('session');
    const parsed = purgeIfExpired(storage, AUTH_JOURNEY_STORAGE_KEY, AUTH_JOURNEY_TTL_MS);
    if (!parsed) return null;

    const mode = resolveMode(parsed.mode);
    const storedStep = resolveStep(parsed.step);
    const otpStage = resolveOtpStage(parsed.otpStage);
    const otpTransport = resolveOtpTransport(parsed.otpTransport);
    const countdown = Math.max(0, Number(parsed.countdown || 0));
    const draft = {
        mode,
        step: storedStep,
        name: normalizeText(parsed.name),
        email: normalizeEmail(parsed.email),
        phone: normalizePhone(parsed.phone),
        otpStage,
        otpTransport,
        countdown,
        fallbackToBackupOtp: Boolean(parsed.fallbackToBackupOtp),
        savedAt: Number(parsed.savedAt || Date.now()),
    };

    const hasIdentity = Boolean(draft.email || draft.phone || draft.name);
    const resumeOtp = canResumeOtpStep(draft);
    if (!hasIdentity && !resumeOtp) {
        clearAuthJourneyDraft();
        return null;
    }

    const resumeMessage = buildResumeMessage({ canResumeOtp: resumeOtp, mode });

    return {
        ...draft,
        canResumeOtp: resumeOtp,
        step: resumeOtp ? 'otp' : 'form',
        otpStage: resumeOtp ? otpStage : 'single',
        otpTransport: resumeOtp ? otpTransport : 'backend_otp',
        countdown: resumeOtp ? countdown : 0,
        savedAtLabel: formatRelativeAge(draft.savedAt),
        resumeMessage,
    };
};

export const writeAuthJourneyDraft = (snapshot = {}) => {
    const storage = getStorage('session');
    if (!storage) return;

    const mode = resolveMode(snapshot.mode);
    const step = resolveStep(snapshot.step);
    const email = normalizeEmail(snapshot.email);
    const phone = normalizePhone(snapshot.phone);
    const name = normalizeText(snapshot.name);
    const hasIdentity = Boolean(email || phone || name);

    if (!hasIdentity) {
        storage.removeItem(AUTH_JOURNEY_STORAGE_KEY);
        return;
    }

    const payload = {
        savedAt: Date.now(),
        mode,
        step,
        name,
        email,
        phone,
        otpStage: resolveOtpStage(snapshot.otpStage),
        otpTransport: resolveOtpTransport(snapshot.otpTransport),
        countdown: Math.max(0, Number(snapshot.countdown || 0)),
        fallbackToBackupOtp: Boolean(snapshot.fallbackToBackupOtp),
    };

    storage.setItem(AUTH_JOURNEY_STORAGE_KEY, JSON.stringify(payload));
};

export const clearAuthJourneyDraft = () => {
    const storage = getStorage('session');
    storage?.removeItem(AUTH_JOURNEY_STORAGE_KEY);
};

const resolveProviderLabel = (providerIds = []) => {
    const safeProviders = Array.isArray(providerIds)
        ? providerIds.map((providerId) => normalizeText(providerId).toLowerCase()).filter(Boolean)
        : [];

    if (safeProviders.some((providerId) => providerId.includes('google'))) return 'Google-ready';
    if (safeProviders.some((providerId) => providerId.includes('facebook'))) return 'Facebook-ready';
    if (safeProviders.some((providerId) => providerId.includes('twitter') || providerId.includes('x.com'))) return 'X-ready';
    if (safeProviders.some((providerId) => providerId.includes('password'))) return 'Password lane';
    return 'Secure lane';
};

export const readAuthIdentityMemory = () => {
    const storage = getStorage('local');
    const parsed = purgeIfExpired(storage, AUTH_IDENTITY_MEMORY_KEY, AUTH_IDENTITY_TTL_MS);
    if (!parsed) return null;

    const email = normalizeEmail(parsed.email);
    const phone = normalizePhone(parsed.phone);
    if (!email && !phone) {
        clearAuthIdentityMemory();
        return null;
    }

    const providerIds = Array.isArray(parsed.providerIds)
        ? parsed.providerIds.map((providerId) => normalizeText(providerId)).filter(Boolean)
        : [];

    return {
        email,
        phone,
        displayName: normalizeText(parsed.displayName),
        assuranceLevel: normalizeText(parsed.assuranceLevel),
        assuranceLabel: normalizeText(parsed.assuranceLabel),
        providerIds,
        providerLabel: resolveProviderLabel(providerIds),
        maskedEmail: maskEmail(email),
        maskedPhone: maskPhone(phone),
        savedAt: Number(parsed.savedAt || Date.now()),
        savedAtLabel: formatRelativeAge(parsed.savedAt),
    };
};

export const writeAuthIdentityMemory = (snapshot = {}) => {
    const storage = getStorage('local');
    if (!storage) return;

    const email = normalizeEmail(snapshot.email);
    const phone = normalizePhone(snapshot.phone);
    if (!email && !phone) {
        storage.removeItem(AUTH_IDENTITY_MEMORY_KEY);
        return;
    }

    const providerIds = Array.isArray(snapshot.providerIds)
        ? snapshot.providerIds.map((providerId) => normalizeText(providerId)).filter(Boolean).slice(0, 5)
        : [];

    const payload = {
        savedAt: Date.now(),
        email,
        phone,
        displayName: normalizeText(snapshot.displayName),
        assuranceLevel: normalizeText(snapshot.assuranceLevel),
        assuranceLabel: normalizeText(snapshot.assuranceLabel),
        providerIds,
    };

    storage.setItem(AUTH_IDENTITY_MEMORY_KEY, JSON.stringify(payload));
};

export const clearAuthIdentityMemory = () => {
    const storage = getStorage('local');
    storage?.removeItem(AUTH_IDENTITY_MEMORY_KEY);
};

export const describeAccelerationLane = ({
    mode = 'signin',
    canUseFirebasePhoneOtp = false,
    socialAuthSupported = false,
    fallbackToBackupOtp = false,
}) => {
    if (mode === 'signin' && socialAuthSupported) {
        return {
            title: 'Instant return lanes',
            detail: 'Social sign-in is available here, and the password plus OTP path is also ready if you want stronger verification.',
        };
    }

    if (canUseFirebasePhoneOtp) {
        return {
            title: 'Dual-channel secure lane',
            detail: mode === 'signup'
                ? 'Email verification and Firebase phone proof will run as one continuous activation chain.'
                : mode === 'forgot-password'
                    ? 'Recovery will verify email first, then finish with Firebase phone proof.'
                    : 'Password verification, email proof, and Firebase phone proof are all available in one accelerated path.',
        };
    }

    if (fallbackToBackupOtp) {
        return {
            title: 'Backup OTP lane',
            detail: 'Firebase phone delivery is paused on this host, so Aura will keep the flow moving with email and mobile backup OTP.',
        };
    }

    return {
        title: 'Standard OTP lane',
        detail: 'Email and OTP verification are available, with your known identity details restored for a faster restart.',
    };
};

