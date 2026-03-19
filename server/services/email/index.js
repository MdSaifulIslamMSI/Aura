const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { flags: securityFlags } = require('../../config/emailSecurityFlags');
const emailFlags = require('../../config/emailFlags');
const { getEmailProvider } = require('./emailProviderFactory');
const {
    persistEmailDeliveryLog,
    sanitizeEmailTags,
} = require('./emailDeliveryAuditService');

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
    const configuredAllowed = securityFlags.emailSecurityAllowedEventTypes.length > 0
        ? securityFlags.emailSecurityAllowedEventTypes
        : [];
    const allowedSet = new Set([
        ...DEFAULT_ALLOWED_EVENTS,
        ...configuredAllowed.map((item) => String(item || '').trim()).filter(Boolean),
    ]);

    if (!resolved) {
        if (securityFlags.emailSecurityStrictMode) {
            throw new AppError('eventType is required in strict email security mode', 400);
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
    if (normalizedSubject.length > securityFlags.emailSecurityMaxSubjectLen) {
        throw new AppError(`Email subject exceeds limit (${securityFlags.emailSecurityMaxSubjectLen})`, 400);
    }

    if (!normalizedHtml && !normalizedText) {
        throw new AppError('Email body is required', 400);
    }
    if (!securityFlags.emailSecurityAllowHtml && normalizedHtml) {
        throw new AppError('HTML content is disabled by email security policy', 400);
    }
    if (normalizedHtml.length > securityFlags.emailSecurityMaxHtmlLen) {
        throw new AppError(`HTML body exceeds limit (${securityFlags.emailSecurityMaxHtmlLen})`, 400);
    }
    if (normalizedText.length > securityFlags.emailSecurityMaxTextLen) {
        throw new AppError(`Text body exceeds limit (${securityFlags.emailSecurityMaxTextLen})`, 400);
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
    const resolvedEventType = securityFlags.emailSecurityEnabled
        ? resolveEventType(eventType)
        : String(eventType || 'system').trim() || 'system';
    const validated = validatePayload({ to, subject, html, text });
    const sanitizedSecurityTags = sanitizeEmailTags(securityTags);
    const sanitizedMeta = sanitizeMeta({
        ...meta,
        securityTags: sanitizedSecurityTags,
    });

    if (!emailFlags.orderEmailsEnabled && ['order_placed', 'order_email_alert'].includes(resolvedEventType)) {
        await persistEmailDeliveryLog({
            eventType: resolvedEventType,
            status: 'skipped',
            provider: 'disabled',
            recipientEmail: validated.to.split(',')[0] || '',
            recipientMask: maskRecipient(validated.to.split(',')[0] || ''),
            subject: validated.subject,
            requestId,
            securityTags: sanitizedSecurityTags,
            metaSummary: { ...sanitizedMeta, reason: 'ORDER_EMAILS_ENABLED=false' },
        });
        return {
            skipped: true,
            provider: 'disabled',
            providerMessageId: '',
            response: { reason: 'ORDER_EMAILS_ENABLED=false' },
        };
    }

    const sanitizedHeaders = sanitizeHeaders(headers);

    const finalHeaders = {
        ...sanitizedHeaders,
        'X-Aura-Event-Type': resolvedEventType,
        'X-Aura-Message-Version': 'security-v3',
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

        await persistEmailDeliveryLog({
            eventType: resolvedEventType,
            status: 'sent',
            provider: result.provider,
            recipientEmail: validated.to.split(',')[0] || '',
            recipientMask,
            subject: validated.subject,
            requestId,
            securityTags: sanitizedSecurityTags,
            providerMessageId: result.providerMessageId || '',
            responseSummary: result.response || {},
            metaSummary: sanitizedMeta,
        });

        return result;
    } catch (error) {
        const providerName = String(provider?.name || provider?.provider || 'unknown').trim() || 'unknown';
        logger.error('email_gateway.failed', buildEmailAuditRecord({
            eventType: resolvedEventType,
            requestId,
            recipientMask,
            provider: providerName,
            status: 'failed',
            errorCode: error.emailCode || error.code || 'UNKNOWN_EMAIL_ERROR',
        }));
        await persistEmailDeliveryLog({
            eventType: resolvedEventType,
            status: 'failed',
            provider: providerName,
            recipientEmail: validated.to.split(',')[0] || '',
            recipientMask,
            subject: validated.subject,
            requestId,
            securityTags: sanitizedSecurityTags,
            errorCode: error.emailCode || error.code || 'UNKNOWN_EMAIL_ERROR',
            errorMessage: error.message || 'Email delivery failed',
            metaSummary: sanitizedMeta,
        });
        throw error;
    }
};

module.exports = {
    sendTransactionalEmail,
    buildEmailAuditRecord,
};
