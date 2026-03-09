const AppError = require('../utils/AppError');

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parseNumber = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    if (num < min) return min;
    if (num > max) return max;
    return num;
};

const asLower = (value, fallback) => String(value || fallback).trim().toLowerCase();
const trim = (value, fallback = '') => String(value || fallback).trim();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const nodeEnv = asLower(process.env.NODE_ENV, 'development');
const isProduction = nodeEnv === 'production';

const flags = {
    nodeEnv,
    isProduction,
    orderEmailsEnabled: parseBoolean(process.env.ORDER_EMAILS_ENABLED, true),
    orderEmailProvider: asLower(process.env.ORDER_EMAIL_PROVIDER, 'null'),
    orderEmailFromName: trim(process.env.ORDER_EMAIL_FROM_NAME, 'Aura Marketplace'),
    orderEmailFromAddress: trim(process.env.ORDER_EMAIL_FROM_ADDRESS, process.env.GMAIL_USER || ''),
    orderEmailReplyTo: trim(process.env.ORDER_EMAIL_REPLY_TO, ''),
    orderEmailMaxRetries: parseNumber(process.env.ORDER_EMAIL_MAX_RETRIES, 8, { min: 1, max: 20 }),
    orderEmailWorkerPollMs: parseNumber(process.env.ORDER_EMAIL_WORKER_POLL_MS, 10000, { min: 1000, max: 120000 }),
    orderEmailAlertTo: trim(process.env.ORDER_EMAIL_ALERT_TO, ''),
    appPublicUrl: trim(process.env.APP_PUBLIC_URL, 'http://localhost:5173'),
};

const assertEmailAddress = (value, fieldName) => {
    if (!EMAIL_REGEX.test(String(value || '').trim())) {
        throw new AppError(`${fieldName} must be a valid email address`, 500);
    }
};

const assertProductionEmailConfig = () => {
    if (!flags.isProduction || !flags.orderEmailsEnabled) return;

    const disabledProviders = ['null', 'none', 'disabled'];
    if (disabledProviders.includes(flags.orderEmailProvider)) {
        // Email explicitly disabled — allowed but warn
        const logger = require('../utils/logger');
        logger.warn('email_config.disabled_in_production', {
            provider: flags.orderEmailProvider,
        });
        return;
    }

    if (flags.orderEmailProvider === 'resend') {
        if (!process.env.RESEND_API_KEY) {
            throw new Error('Missing RESEND_API_KEY for production resend email mode');
        }
        assertEmailAddress(flags.orderEmailFromAddress, 'ORDER_EMAIL_FROM_ADDRESS');
        if (flags.orderEmailReplyTo) {
            assertEmailAddress(flags.orderEmailReplyTo, 'ORDER_EMAIL_REPLY_TO');
        }
        if (!flags.orderEmailAlertTo) {
            throw new Error('ORDER_EMAIL_ALERT_TO is required in production for terminal email failures');
        }
        assertEmailAddress(flags.orderEmailAlertTo, 'ORDER_EMAIL_ALERT_TO');
        return;
    }

    if (flags.orderEmailProvider === 'gmail') {
        if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
            throw new Error('Missing Gmail credentials for production order email mode');
        }
        assertEmailAddress(flags.orderEmailFromAddress, 'ORDER_EMAIL_FROM_ADDRESS');
        if (flags.orderEmailReplyTo) {
            assertEmailAddress(flags.orderEmailReplyTo, 'ORDER_EMAIL_REPLY_TO');
        }
        if (!flags.orderEmailAlertTo) {
            throw new Error('ORDER_EMAIL_ALERT_TO is required in production for terminal email failures');
        }
        assertEmailAddress(flags.orderEmailAlertTo, 'ORDER_EMAIL_ALERT_TO');
        return;
    }

    throw new Error(`Unsupported ORDER_EMAIL_PROVIDER in production: ${flags.orderEmailProvider}`);
};

module.exports = {
    flags,
    parseBoolean,
    assertProductionEmailConfig,
    EMAIL_REGEX,
};
