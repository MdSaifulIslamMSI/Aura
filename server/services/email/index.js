const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { flags: emailFlags } = require('../../config/emailFlags');
const { flags: fortressFlags } = require('../../config/emailFortressFlags');
const { getEmailProvider } = require('./emailProviderFactory');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEADER_KEY_REGEX = /^[A-Za-z0-9-]{1,64}$/;
const DEFAULT_ALLOWED_EVENTS = new Set(['otp_security', 'order_placed', 'order_email_alert', 'user_activity', 'system']);

const maskRecipient = (recipient = '') => String(recipient || '').replace(/(.{2}).*(@.*)/, '$1***$2');

const normalizeRecipients = (to) => {
    if (Array.isArray(to)) {
        const list = to.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
        if (list.length === 0) throw new AppError('Recipient is required', 400);
        list.forEach((email) => {
            if (!EMAIL_REGEX.test(email)) throw new AppError('Recipient email format is invalid', 400);
        });
        return list.join(', ');
    }

    const value = String(to || '').trim();
    if (!value) throw new AppError('Recipient is required', 400);
    const parts = value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (parts.length === 0) throw new AppError('Recipient is required', 400);
    parts.forEach((email) => {
        if (!EMAIL_REGEX.test(email)) throw new AppError('Recipient email format is invalid', 400);
    });
    return parts.join(', ');
};

const sanitizeHeaders = (headers = {}) => {
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
    const sanitized = {};
    Object.entries(headers).forEach(([key, value]) => {
        const headerKey = String(key || '').trim();
        if (!HEADER_KEY_REGEX.test(headerKey)) return;
        const headerValue = String(value ?? '').trim();
        if (!headerValue || headerValue.length > 512) return;
        sanitized[headerKey] = headerValue;
    });
    return sanitized;
};

const sanitizeMeta = (meta = {}) => {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
    try {
        const serialized = JSON.stringify(meta);
        if (serialized.length > 5000) {
            return { note: 'meta_truncated_for_policy' };
        }
        return JSON.parse(serialized);
    } catch {
        return { note: 'meta_invalid_json' };
    }
};

const resolveEventType = (eventType) => {
    const resolved = String(eventType || '').trim();
    const configuredAllowed = fortressFlags.emailFortressAllowedEventTypes.length > 0
        ? fortressFlags.emailFortressAllowedEventTypes
        : [];
    const allowedSet = new Set([
        ...DEFAULT_ALLOWED_EVENTS,
        ...configuredAllowed.map((item) => String(item || '').trim()).filter(Boolean),
    ]);

    if (!resolved) {
        if (fortressFlags.emailFortressStrictMode) {
            throw new AppError('eventType is required in strict email fortress mode', 400);
        }
        return 'system';
    }

    if (!allowedSet.has(resolved)) {
        throw new AppError(`eventType is not allowed: ${resolved}`, 400);
    }
    return resolved;
};

const validatePayload = ({ to, subject, html, text }) => {
    const normalizedTo = normalizeRecipients(to);
    const normalizedSubject = String(subject || '').trim();
    const normalizedHtml = String(html || '');
    const normalizedText = String(text || '');

    if (!normalizedSubject) throw new AppError('Email subject is required', 400);
    if (normalizedSubject.length > fortressFlags.emailFortressMaxSubjectLen) {
        throw new AppError(`Email subject exceeds limit (${fortressFlags.emailFortressMaxSubjectLen})`, 400);
    }

    if (!normalizedHtml && !normalizedText) {
        throw new AppError('Email body is required', 400);
    }
    if (!fortressFlags.emailFortressAllowHtml && normalizedHtml) {
        throw new AppError('HTML content is disabled by email fortress policy', 400);
    }
    if (normalizedHtml.length > fortressFlags.emailFortressMaxHtmlLen) {
        throw new AppError(`HTML body exceeds limit (${fortressFlags.emailFortressMaxHtmlLen})`, 400);
    }
    if (normalizedText.length > fortressFlags.emailFortressMaxTextLen) {
        throw new AppError(`Text body exceeds limit (${fortressFlags.emailFortressMaxTextLen})`, 400);
    }

    return {
        to: normalizedTo,
        subject: normalizedSubject,
        html: normalizedHtml,
        text: normalizedText,
    };
};

const buildEmailAuditRecord = ({
    eventType,
    requestId,
    recipientMask,
    provider,
    status,
    errorCode = '',
}) => ({
    eventType,
    requestId: String(requestId || ''),
    recipient: recipientMask,
    provider: provider || 'unknown',
    status,
    errorCode: errorCode || '',
});

const sendTransactionalEmail = async ({
    eventType,
    to,
    subject,
    html,
    text = '',
    headers = {},
    meta = {},
    requestId = '',
    securityTags = [],
}) => {
    const resolvedEventType = fortressFlags.emailFortressEnabled
        ? resolveEventType(eventType)
        : String(eventType || 'system').trim() || 'system';

    if (!emailFlags.orderEmailsEnabled && ['order_placed', 'order_email_alert'].includes(resolvedEventType)) {
        return {
            skipped: true,
            provider: 'disabled',
            providerMessageId: '',
            response: { reason: 'ORDER_EMAILS_ENABLED=false' },
        };
    }

    const validated = validatePayload({ to, subject, html, text });
    const sanitizedHeaders = sanitizeHeaders(headers);
    const sanitizedMeta = sanitizeMeta({
        ...meta,
        securityTags: Array.isArray(securityTags) ? securityTags.slice(0, 20) : [],
    });

    const finalHeaders = {
        ...sanitizedHeaders,
        'X-Aura-Event-Type': resolvedEventType,
        'X-Aura-Message-Version': 'fortress-v3',
        ...(requestId ? { 'X-Request-Id': String(requestId) } : {}),
    };

    const recipientMask = maskRecipient(validated.to.split(',')[0] || '');
    const provider = getEmailProvider();

    try {
        const result = await provider.sendTransactionalEmail({
            to: validated.to,
            subject: validated.subject,
            html: validated.html,
            text: validated.text,
            headers: finalHeaders,
            meta: sanitizedMeta,
        });

        logger.info('email_gateway.sent', buildEmailAuditRecord({
            eventType: resolvedEventType,
            requestId,
            recipientMask,
            provider: result.provider,
            status: 'sent',
        }));

        return result;
    } catch (error) {
        logger.error('email_gateway.failed', buildEmailAuditRecord({
            eventType: resolvedEventType,
            requestId,
            recipientMask,
            provider: 'unknown',
            status: 'failed',
            errorCode: error.emailCode || error.code || 'UNKNOWN_EMAIL_ERROR',
        }));
        throw error;
    }
};

module.exports = {
    sendTransactionalEmail,
    buildEmailAuditRecord,
};
