const logger = require('../../utils/logger');
const { EMAIL_REGEX } = require('../../config/emailFlags');
const { flags: activityFlags } = require('../../config/activityEmailFlags');
const { sendTransactionalEmail } = require('./index');
const {
    maskIpAddress,
    getDeviceLabelFromUserAgent,
} = require('./templateUtils');
const { renderActivityTemplate } = require('./templates/activityTemplate');

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const safeString = (value, fallback = '-') => {
    const normalized = String(value || '').trim();
    return normalized || fallback;
};

const notifyAdminActionToUser = async ({
    targetUser,
    actorUser,
    actionKey = 'admin.action',
    actionTitle = 'Account Administrative Update',
    actionSummary = 'An administrator action was applied to your account.',
    highlights = [],
    requestId = '',
    method = 'ADMIN',
    path = '/api/admin',
    ip = '',
    userAgent = '',
    ctaUrl = activityFlags.activityEmailCtaUrl,
    ctaLabel = 'Open Security Dashboard',
}) => {
    const recipient = normalizeEmail(targetUser?.email);
    if (!EMAIL_REGEX.test(recipient)) {
        return { skipped: true, reason: 'target_email_invalid' };
    }

    const actorEmail = normalizeEmail(actorUser?.email);
    const mergedHighlights = [
        `Action key: ${safeString(actionKey)}`,
        `Performed by: ${safeString(actorEmail, 'admin')}`,
        ...((Array.isArray(highlights) ? highlights : []).slice(0, 8).map((item) => safeString(item))),
    ];

    const template = renderActivityTemplate({
        brand: 'AURA',
        userName: targetUser?.name || recipient.split('@')[0] || 'there',
        actionTitle,
        actionSummary,
        highlights: mergedHighlights,
        requestId: requestId || '',
        method: method || 'ADMIN',
        path: path || '/api/admin',
        deviceLabel: getDeviceLabelFromUserAgent(userAgent || ''),
        maskedIp: maskIpAddress(ip || ''),
        occurredAt: new Date(),
        ctaUrl,
        ctaLabel,
    });

    try {
        await sendTransactionalEmail({
            eventType: 'user_activity',
            to: recipient,
            subject: template.subject,
            html: template.html,
            text: template.text,
            requestId,
            headers: {
                'X-Aura-Admin-Action': safeString(actionKey).slice(0, 120),
            },
            meta: {
                actionKey: safeString(actionKey),
                method: method || 'ADMIN',
                path: path || '/api/admin',
                actorEmail: actorEmail || '',
                targetUserId: String(targetUser?._id || ''),
            },
            securityTags: ['admin-action', safeString(actionKey).replace(/\s+/g, '_').toLowerCase()],
        });

        logger.info('admin_action_email.sent', {
            requestId: requestId || '',
            actionKey: safeString(actionKey),
            actorEmail: actorEmail || '',
            recipient: recipient.replace(/(.{2}).*(@.*)/, '$1***$2'),
        });

        return { skipped: false };
    } catch (error) {
        logger.error('admin_action_email.failed', {
            requestId: requestId || '',
            actionKey: safeString(actionKey),
            actorEmail: actorEmail || '',
            recipient: recipient.replace(/(.{2}).*(@.*)/, '$1***$2'),
            error: error.message,
        });
        return { skipped: true, reason: 'send_failed', error: error.message };
    }
};

module.exports = {
    notifyAdminActionToUser,
};
