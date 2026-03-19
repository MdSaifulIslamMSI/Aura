const EmailDeliveryLog = require('../../models/EmailDeliveryLog');
const { flags: emailFlags } = require('../../config/emailFlags');
const { flags: activityEmailFlags } = require('../../config/activityEmailFlags');
const { sendTransactionalEmail } = require('./index');
const {
    getOrderEmailQueueStats,
    listOrderEmailNotifications,
    getOrderEmailNotificationById,
    retryOrderEmailNotification,
} = require('./orderEmailQueueService');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const buildSearchQuery = (search) => {
    const value = String(search || '').trim();
    if (!value) return null;
    return {
        $or: [
            { eventType: { $regex: value, $options: 'i' } },
            { provider: { $regex: value, $options: 'i' } },
            { recipientEmail: { $regex: value, $options: 'i' } },
            { requestId: { $regex: value, $options: 'i' } },
            { subject: { $regex: value, $options: 'i' } },
            { errorCode: { $regex: value, $options: 'i' } },
        ],
    };
};

const buildDeliveryQuery = ({
    status,
    provider,
    eventType,
    search,
}) => {
    const query = {};
    if (status) query.status = String(status).trim();
    if (provider) query.provider = String(provider).trim().toLowerCase();
    if (eventType) query.eventType = String(eventType).trim();

    const searchQuery = buildSearchQuery(search);
    if (searchQuery) Object.assign(query, searchQuery);
    return query;
};

const getEmailOpsSummary = async () => {
    const since = new Date(Date.now() - (24 * 60 * 60 * 1000));
    const [queue, latestDeliveries, totalsByStatus, totalsByEventType, totalsByLifecycle, recentFailures] = await Promise.all([
        getOrderEmailQueueStats().catch(() => ({ status: 'degraded', pending: 0, processing: 0, retry: 0, failed: 0 })),
        EmailDeliveryLog.find({})
            .sort({ createdAt: -1 })
            .limit(8)
            .lean(),
        EmailDeliveryLog.aggregate([
            { $match: { createdAt: { $gte: since } } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        EmailDeliveryLog.aggregate([
            { $match: { createdAt: { $gte: since } } },
            { $group: { _id: '$eventType', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 6 },
        ]),
        EmailDeliveryLog.aggregate([
            { $match: { createdAt: { $gte: since } } },
            { $group: { _id: '$lifecycleStatus', count: { $sum: 1 } } },
        ]),
        EmailDeliveryLog.find({ status: 'failed' })
            .sort({ createdAt: -1 })
            .limit(6)
            .lean(),
    ]);

    const statusCounts = {
        sent: 0,
        failed: 0,
        skipped: 0,
    };
    totalsByStatus.forEach((entry) => {
        statusCounts[String(entry?._id || '').trim()] = Number(entry?.count || 0);
    });

    const lifecycleCounts = {};
    totalsByLifecycle.forEach((entry) => {
        lifecycleCounts[String(entry?._id || '').trim() || 'unknown'] = Number(entry?.count || 0);
    });

    return {
        provider: {
            active: emailFlags.orderEmailProvider,
            orderEmailsEnabled: emailFlags.orderEmailsEnabled,
            activityEmailsEnabled: activityEmailFlags.activityEmailsEnabled,
            resendWebhookConfigured: Boolean(process.env.RESEND_WEBHOOK_SECRET),
            fromName: emailFlags.orderEmailFromName,
            fromAddress: emailFlags.orderEmailFromAddress,
            replyTo: emailFlags.orderEmailReplyTo,
            alertTo: emailFlags.orderEmailAlertTo,
            available: {
                gmail: Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
                resend: Boolean(process.env.RESEND_API_KEY),
            },
        },
        queue,
        last24h: {
            total: statusCounts.sent + statusCounts.failed + statusCounts.skipped,
            statuses: statusCounts,
            lifecycle: lifecycleCounts,
            eventTypes: totalsByEventType.map((entry) => ({
                eventType: String(entry?._id || 'unknown'),
                count: Number(entry?.count || 0),
            })),
        },
        latestDeliveries,
        recentFailures,
    };
};

const listEmailDeliveries = async ({
    page = DEFAULT_PAGE,
    limit = DEFAULT_LIMIT,
    status,
    provider,
    eventType,
    search,
}) => {
    const safePage = Math.max(Number(page) || DEFAULT_PAGE, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), 100);
    const query = buildDeliveryQuery({ status, provider, eventType, search });
    const skip = (safePage - 1) * safeLimit;

    const [items, total] = await Promise.all([
        EmailDeliveryLog.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(safeLimit)
            .lean(),
        EmailDeliveryLog.countDocuments(query),
    ]);

    return {
        page: safePage,
        limit: safeLimit,
        total,
        items,
    };
};

const resolveTestRecipient = ({ actorEmail = '', requestedRecipient = '' }) => {
    const candidates = [
        String(requestedRecipient || '').trim().toLowerCase(),
        String(actorEmail || '').trim().toLowerCase(),
        String(emailFlags.orderEmailAlertTo || '').trim().toLowerCase(),
        String(emailFlags.orderEmailFromAddress || '').trim().toLowerCase(),
    ].filter(Boolean);

    const found = candidates.find((candidate) => EMAIL_REGEX.test(candidate));
    if (!found) {
        throw new Error('No valid designate recipient configured for test email');
    }
    return found;
};

const sendAdminTestEmail = async ({
    actorEmail = '',
    actorName = '',
    recipientEmail = '',
    requestId = '',
}) => {
    const to = resolveTestRecipient({ actorEmail, requestedRecipient: recipientEmail });
    const timestamp = new Date().toISOString();
    const subject = 'Aura Admin Email Ops Test';
    const text = [
        'This is a controlled email operations test from Aura.',
        `Triggered by: ${String(actorName || actorEmail || 'admin').trim()}`,
        `Recipient: ${to}`,
        `Timestamp: ${timestamp}`,
        `Request ID: ${String(requestId || '').trim() || 'n/a'}`,
    ].join('\n');
    const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h2>Aura Admin Email Ops Test</h2>
            <p>This is a controlled email operations test from Aura.</p>
            <p><strong>Triggered by:</strong> ${String(actorName || actorEmail || 'admin')}</p>
            <p><strong>Recipient:</strong> ${to}</p>
            <p><strong>Timestamp:</strong> ${timestamp}</p>
            <p><strong>Request ID:</strong> ${String(requestId || '').trim() || 'n/a'}</p>
        </div>
    `;

    const result = await sendTransactionalEmail({
        eventType: 'system',
        to,
        subject,
        text,
        html,
        requestId,
        headers: {
            'X-Aura-Admin-Test': 'email-ops',
        },
        meta: {
            source: 'admin_email_ops_test',
            triggeredBy: String(actorEmail || '').trim().toLowerCase(),
        },
        securityTags: ['admin-test', 'email-ops', 'system'],
    });

    return {
        recipientEmail: to,
        provider: result.provider,
        providerMessageId: result.providerMessageId || '',
    };
};

module.exports = {
    getEmailOpsSummary,
    listEmailDeliveries,
    listOrderEmailNotifications,
    getOrderEmailNotificationById,
    retryOrderEmailNotification,
    sendAdminTestEmail,
};
