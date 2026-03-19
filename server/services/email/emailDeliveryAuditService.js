const mongoose = require('mongoose');
const logger = require('../../utils/logger');
const EmailDeliveryLog = require('../../models/EmailDeliveryLog');

const EMAIL_TAG_REGEX = /[^A-Za-z0-9_-]+/g;

const sanitizeEmailTag = (tag) => String(tag || '')
    .trim()
    .replace(EMAIL_TAG_REGEX, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 64);

const sanitizeEmailTags = (tags = []) => {
    if (!Array.isArray(tags)) return [];
    const seen = new Set();
    return tags
        .map(sanitizeEmailTag)
        .filter(Boolean)
        .filter((tag) => {
            if (seen.has(tag)) return false;
            seen.add(tag);
            return true;
        })
        .slice(0, 10);
};

const buildResponseSummary = (response = {}) => {
    if (!response || typeof response !== 'object') return {};
    return {
        acceptedCount: Array.isArray(response.accepted) ? response.accepted.length : 0,
        rejectedCount: Array.isArray(response.rejected) ? response.rejected.length : 0,
        envelope: response.envelope || {},
        response: String(response.response || '').slice(0, 240),
    };
};

const buildMetaSummary = (meta = {}) => {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
    const summary = {};
    Object.entries(meta).slice(0, 20).forEach(([key, value]) => {
        if (key === 'securityTags') return;
        if (value === null || value === undefined) return;
        if (typeof value === 'string') {
            summary[key] = value.slice(0, 240);
            return;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            summary[key] = value;
            return;
        }
        summary[key] = String(value).slice(0, 240);
    });
    return summary;
};

const mapGatewayStatusToLifecycle = (status) => {
    switch (String(status || '').trim().toLowerCase()) {
        case 'sent':
            return 'sent';
        case 'failed':
            return 'failed';
        case 'skipped':
            return 'skipped';
        default:
            return 'queued';
    }
};

const mapWebhookTypeToLifecycle = (type) => {
    switch (String(type || '').trim().toLowerCase()) {
        case 'email.sent':
            return 'sent';
        case 'email.delivered':
            return 'delivered';
        case 'email.delivery_delayed':
            return 'delivery_delayed';
        case 'email.bounced':
            return 'bounced';
        case 'email.complained':
            return 'complained';
        case 'email.opened':
            return 'opened';
        case 'email.clicked':
            return 'clicked';
        case 'email.failed':
            return 'failed';
        case 'email.suppressed':
            return 'suppressed';
        case 'email.received':
            return 'received';
        default:
            return 'unknown';
    }
};

const mapLifecycleToGatewayStatus = (lifecycleStatus) => {
    switch (String(lifecycleStatus || '').trim().toLowerCase()) {
        case 'failed':
        case 'bounced':
        case 'complained':
        case 'suppressed':
            return 'failed';
        case 'skipped':
            return 'skipped';
        default:
            return 'sent';
    }
};

const persistEmailDeliveryLog = async ({
    eventType,
    status,
    provider = 'unknown',
    recipientEmail = '',
    recipientMask = '',
    subject = '',
    requestId = '',
    securityTags = [],
    providerMessageId = '',
    errorCode = '',
    errorMessage = '',
    responseSummary = {},
    metaSummary = {},
}) => {
    if (mongoose.connection.readyState !== 1) {
        logger.debug('email_delivery_audit.skipped_no_db', {
            eventType,
            status,
            requestId: String(requestId || ''),
        });
        return null;
    }

    try {
        return await EmailDeliveryLog.create({
            eventType: String(eventType || 'system').trim() || 'system',
            status,
            lifecycleStatus: mapGatewayStatusToLifecycle(status),
            provider: String(provider || 'unknown').trim() || 'unknown',
            recipientEmail: String(recipientEmail || '').trim().toLowerCase(),
            recipientMask: String(recipientMask || '').trim(),
            subject: String(subject || '').trim().slice(0, 240),
            requestId: String(requestId || '').trim().slice(0, 120),
            securityTags: sanitizeEmailTags(securityTags),
            providerMessageId: String(providerMessageId || '').trim().slice(0, 160),
            errorCode: String(errorCode || '').trim().slice(0, 80),
            errorMessage: String(errorMessage || '').trim().slice(0, 500),
            responseSummary: buildResponseSummary(responseSummary),
            metaSummary: buildMetaSummary(metaSummary),
        });
    } catch (error) {
        logger.warn('email_delivery_audit.persist_failed', {
            eventType,
            status,
            requestId: String(requestId || ''),
            error: error.message,
        });
        return null;
    }
};

const buildWebhookEventSummary = (payload = {}) => {
    const data = payload?.data || {};
    const primary = [
        data?.from,
        Array.isArray(data?.to) ? data.to.join(', ') : data?.to,
        data?.subject,
        data?.bounce?.type,
        data?.bounce?.subType,
        data?.click?.link,
    ].filter(Boolean);
    return primary.join(' | ').slice(0, 500);
};

const extractWebhookMetaSummary = (payload = {}) => {
    const data = payload?.data || {};
    return buildMetaSummary({
        webhookCreatedAt: payload?.created_at || payload?.createdAt || '',
        webhookType: payload?.type || '',
        to: Array.isArray(data?.to) ? data.to.join(', ') : data?.to || '',
        from: data?.from || '',
        subject: data?.subject || '',
        tags: Array.isArray(data?.tags) ? data.tags.map((item) => item?.name || item).join(', ') : '',
    });
};

const recordEmailWebhookEvent = async ({
    provider = 'resend',
    webhookEventId = '',
    webhookType = '',
    providerMessageId = '',
    recipientEmail = '',
    subject = '',
    requestId = '',
    payload = {},
}) => {
    if (mongoose.connection.readyState !== 1) {
        logger.debug('email_delivery_webhook.skipped_no_db', {
            provider,
            webhookEventId,
            webhookType,
        });
        return { skipped: true, reason: 'db_unavailable' };
    }

    const cleanProvider = String(provider || 'resend').trim().toLowerCase() || 'resend';
    const cleanEventId = String(webhookEventId || '').trim();
    const cleanWebhookType = String(webhookType || '').trim();
    const cleanMessageId = String(providerMessageId || '').trim();
    const lifecycleStatus = mapWebhookTypeToLifecycle(cleanWebhookType);
    const cleanRecipient = String(recipientEmail || '').trim().toLowerCase();
    const webhookAt = payload?.created_at || payload?.createdAt ? new Date(payload.created_at || payload.createdAt) : new Date();
    const summary = buildWebhookEventSummary(payload);
    const metaSummary = extractWebhookMetaSummary(payload);
    const eventRecord = {
        eventId: cleanEventId,
        type: cleanWebhookType,
        occurredAt: webhookAt,
        summary,
    };

    let existing = null;
    if (cleanMessageId) {
        existing = await EmailDeliveryLog.findOne({ provider: cleanProvider, providerMessageId: cleanMessageId });
    }

    if (existing) {
        if (cleanEventId && Array.isArray(existing.providerWebhookEventIds) && existing.providerWebhookEventIds.includes(cleanEventId)) {
            return { skipped: true, reason: 'duplicate_webhook', item: existing.toObject() };
        }

        existing.lifecycleStatus = lifecycleStatus;
        existing.lastWebhookType = cleanWebhookType;
        existing.lastWebhookAt = webhookAt;
        existing.webhookEvents = [...(existing.webhookEvents || []), eventRecord].slice(-20);
        existing.providerWebhookEventIds = cleanEventId
            ? [...new Set([...(existing.providerWebhookEventIds || []), cleanEventId])].slice(-50)
            : existing.providerWebhookEventIds || [];
        if (!existing.recipientEmail && cleanRecipient) existing.recipientEmail = cleanRecipient;
        if (!existing.subject && subject) existing.subject = String(subject).slice(0, 240);
        existing.metaSummary = { ...(existing.metaSummary || {}), ...metaSummary };
        await existing.save();
        return { skipped: false, item: existing.toObject() };
    }

    const created = await EmailDeliveryLog.create({
        eventType: cleanWebhookType || 'system',
        status: mapLifecycleToGatewayStatus(lifecycleStatus),
        lifecycleStatus,
        provider: cleanProvider,
        recipientEmail: cleanRecipient,
        recipientMask: cleanRecipient ? cleanRecipient.replace(/(.{2}).*(@.*)/, '$1***$2') : '',
        subject: String(subject || '').slice(0, 240),
        requestId: String(requestId || cleanEventId || '').slice(0, 120),
        providerMessageId: cleanMessageId,
        responseSummary: {},
        metaSummary,
        lastWebhookType: cleanWebhookType,
        lastWebhookAt: webhookAt,
        providerWebhookEventIds: cleanEventId ? [cleanEventId] : [],
        webhookEvents: [eventRecord],
    });

    return { skipped: false, item: created.toObject() };
};

module.exports = {
    sanitizeEmailTag,
    sanitizeEmailTags,
    persistEmailDeliveryLog,
    mapWebhookTypeToLifecycle,
    mapLifecycleToGatewayStatus,
    recordEmailWebhookEvent,
};
