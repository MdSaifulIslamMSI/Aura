const { parseBoolean, parseNumber, parseCsv } = require('./emailSecurityFlags');
const { flags: emailFlags } = require('./emailFlags');

const trim = (value, fallback = '') => String(value || fallback).trim();

const flags = {
    activityEmailsEnabled: parseBoolean(process.env.ACTIVITY_EMAILS_ENABLED, true),
    activityEmailCooldownSec: parseNumber(process.env.ACTIVITY_EMAIL_COOLDOWN_SEC, 0, { min: 0, max: 86400 }),
    activityEmailMaxHighlights: parseNumber(process.env.ACTIVITY_EMAIL_MAX_HIGHLIGHTS, 6, { min: 1, max: 20 }),
    activityEmailExcludedPaths: parseCsv(
        process.env.ACTIVITY_EMAIL_EXCLUDED_PATHS,
        ['/health', '/health/ready', '/api/otp', '/api/observability']
    ),
    activityEmailCtaUrl: trim(process.env.ACTIVITY_EMAIL_CTA_URL, emailFlags.appPublicUrl || 'http://localhost:5173/profile'),
};

module.exports = {
    flags,
};
