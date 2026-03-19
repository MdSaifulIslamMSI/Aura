const asyncHandler = require('express-async-handler');
const { Webhook } = require('svix');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { recordEmailWebhookEvent } = require('../services/email/emailDeliveryAuditService');

const getSvixHeaders = (req) => ({
    'svix-id': String(req.headers['svix-id'] || ''),
    'svix-timestamp': String(req.headers['svix-timestamp'] || ''),
    'svix-signature': String(req.headers['svix-signature'] || ''),
});

const verifyResendWebhookPayload = ({ req }) => {
    const secret = String(process.env.RESEND_WEBHOOK_SECRET || '').trim();
    if (!secret) {
        throw new AppError('Resend webhook secret is not configured', 503);
    }

    const payload = req.rawBody || JSON.stringify(req.body || {});
    if (!payload) {
        throw new AppError('Missing webhook payload', 400);
    }

    const headers = getSvixHeaders(req);
    if (!headers['svix-id'] || !headers['svix-timestamp'] || !headers['svix-signature']) {
        throw new AppError('Missing webhook verification headers', 400);
    }

    const webhook = new Webhook(secret);
    return {
        payload,
        headers,
        verified: webhook.verify(payload, headers),
    };
};

const handleResendWebhook = asyncHandler(async (req, res, next) => {
    try {
        const { verified, headers } = verifyResendWebhookPayload({ req });
        const data = verified?.data || {};
        const to = Array.isArray(data?.to) ? data.to[0] : data?.to || '';
        const tags = Array.isArray(data?.tags)
            ? data.tags.map((tag) => tag?.name || tag).filter(Boolean)
            : [];

        const result = await recordEmailWebhookEvent({
            provider: 'resend',
            webhookEventId: headers['svix-id'],
            webhookType: verified?.type || '',
            providerMessageId: data?.email_id || data?.id || '',
            recipientEmail: to,
            subject: data?.subject || '',
            requestId: req.requestId || headers['svix-id'],
            payload: verified,
        });

        logger.info('email_webhook.resend_processed', {
            requestId: req.requestId || headers['svix-id'],
            webhookId: headers['svix-id'],
            type: verified?.type || '',
            providerMessageId: data?.email_id || data?.id || '',
            tags,
            skipped: Boolean(result?.skipped),
        });

        return res.status(200).json({
            success: true,
            skipped: Boolean(result?.skipped),
            reason: result?.reason || '',
        });
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to process resend webhook', 400));
    }
});

module.exports = {
    handleResendWebhook,
};
