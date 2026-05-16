const EMERGENCY_FLAG_KEYS = Object.freeze([
    'GLOBAL_MAINTENANCE',
    'READ_ONLY_MODE',
    'DISABLE_LOGIN',
    'DISABLE_SIGNUP',
    'DISABLE_CHECKOUT',
    'DISABLE_PAYMENT',
    'DISABLE_OTP_SEND',
    'DISABLE_PASSWORD_RESET',
    'DISABLE_AI_ASSISTANT',
    'DISABLE_ADMIN_MUTATIONS',
    'DISABLE_REFUNDS',
    'DISABLE_ORDER_CANCELLATION',
    'STRICT_RATE_LIMIT_MODE',
    'FORCE_LOGOUT_ALL_USERS',
    'DISABLE_PUBLIC_API_MUTATIONS',
    'SHOW_EMERGENCY_BANNER',
]);

const EMERGENCY_SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical']);
const EMERGENCY_SCOPES = Object.freeze(['global', 'auth', 'checkout', 'payment', 'admin', 'ai', 'api']);

const EMERGENCY_FLAG_SET = new Set(EMERGENCY_FLAG_KEYS);
const CRITICAL_CONFIRMATION_KEYS = new Set([
    'GLOBAL_MAINTENANCE',
    'READ_ONLY_MODE',
    'FORCE_LOGOUT_ALL_USERS',
]);

const EMERGENCY_CONFIRMATION_PHRASE = 'I UNDERSTAND';

const DEFAULT_EXPIRY_MINUTES = Object.freeze({
    GLOBAL_MAINTENANCE: 30,
    READ_ONLY_MODE: 60,
    DISABLE_PAYMENT: 120,
    DISABLE_OTP_SEND: 60,
    DISABLE_CHECKOUT: 120,
});

const PUBLIC_DISABLED_FEATURES = Object.freeze({
    DISABLE_CHECKOUT: 'checkout',
    DISABLE_PAYMENT: 'payment',
    DISABLE_OTP_SEND: 'otp',
    DISABLE_PASSWORD_RESET: 'password_reset',
    DISABLE_AI_ASSISTANT: 'ai',
    DISABLE_LOGIN: 'login',
    DISABLE_SIGNUP: 'signup',
    DISABLE_REFUNDS: 'refunds',
    DISABLE_ORDER_CANCELLATION: 'order_cancellation',
    DISABLE_PUBLIC_API_MUTATIONS: 'public_api_mutations',
    DISABLE_ADMIN_MUTATIONS: 'admin_mutations',
});

const ENV_OVERRIDE_BY_KEY = Object.freeze(
    EMERGENCY_FLAG_KEYS.reduce((acc, key) => {
        acc[key] = `EMERGENCY_${key}`;
        return acc;
    }, {})
);

const DEFAULT_EMERGENCY_FLAGS = Object.freeze({
    GLOBAL_MAINTENANCE: {
        severity: 'critical',
        scope: 'global',
        userMessage: 'We are temporarily performing emergency maintenance. Please try again later.',
    },
    READ_ONLY_MODE: {
        severity: 'high',
        scope: 'global',
        userMessage: 'The system is temporarily in read-only mode.',
    },
    DISABLE_LOGIN: {
        severity: 'high',
        scope: 'auth',
        userMessage: 'Login is temporarily unavailable. Please try again later.',
    },
    DISABLE_SIGNUP: {
        severity: 'medium',
        scope: 'auth',
        userMessage: 'Signup is temporarily unavailable. Please try again later.',
    },
    DISABLE_CHECKOUT: {
        severity: 'high',
        scope: 'checkout',
        userMessage: 'Checkout is temporarily unavailable. You can continue browsing products.',
    },
    DISABLE_PAYMENT: {
        severity: 'critical',
        scope: 'payment',
        userMessage: 'Payments are temporarily unavailable. Please try again later.',
    },
    DISABLE_OTP_SEND: {
        severity: 'high',
        scope: 'auth',
        userMessage: 'Verification is temporarily unavailable. Please try again later.',
    },
    DISABLE_PASSWORD_RESET: {
        severity: 'high',
        scope: 'auth',
        userMessage: 'Password reset is temporarily unavailable. Please try again later.',
    },
    DISABLE_AI_ASSISTANT: {
        severity: 'medium',
        scope: 'ai',
        userMessage: 'The assistant is temporarily unavailable. Please contact support if you need help.',
    },
    DISABLE_ADMIN_MUTATIONS: {
        severity: 'critical',
        scope: 'admin',
        userMessage: 'Administrative changes are temporarily unavailable.',
    },
    DISABLE_REFUNDS: {
        severity: 'high',
        scope: 'payment',
        userMessage: 'Refund actions are temporarily unavailable. Existing requests remain safe.',
    },
    DISABLE_ORDER_CANCELLATION: {
        severity: 'medium',
        scope: 'checkout',
        userMessage: 'Order cancellation is temporarily unavailable. Please contact support.',
    },
    STRICT_RATE_LIMIT_MODE: {
        severity: 'high',
        scope: 'api',
        userMessage: 'Some actions may be rate limited while we protect the platform.',
    },
    FORCE_LOGOUT_ALL_USERS: {
        severity: 'critical',
        scope: 'auth',
        userMessage: 'For your safety, please sign in again.',
    },
    DISABLE_PUBLIC_API_MUTATIONS: {
        severity: 'high',
        scope: 'api',
        userMessage: 'Some account and marketplace actions are temporarily unavailable.',
    },
    SHOW_EMERGENCY_BANNER: {
        severity: 'low',
        scope: 'global',
        userMessage: 'We are monitoring an active platform incident. Some features may be temporarily unavailable.',
    },
});

const normalizeEmergencyFlagKey = (value) => String(value || '').trim().toUpperCase();

const isValidEmergencyFlagKey = (value) => EMERGENCY_FLAG_SET.has(normalizeEmergencyFlagKey(value));

module.exports = {
    CRITICAL_CONFIRMATION_KEYS,
    DEFAULT_EMERGENCY_FLAGS,
    DEFAULT_EXPIRY_MINUTES,
    EMERGENCY_CONFIRMATION_PHRASE,
    EMERGENCY_FLAG_KEYS,
    EMERGENCY_FLAG_SET,
    EMERGENCY_SCOPES,
    EMERGENCY_SEVERITIES,
    ENV_OVERRIDE_BY_KEY,
    PUBLIC_DISABLED_FEATURES,
    isValidEmergencyFlagKey,
    normalizeEmergencyFlagKey,
};
