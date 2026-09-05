const AuthSecurityEventOutbox = require('../models/AuthSecurityEventOutbox');
const { writeSecurityEvent } = require('../security/securityEventLogger');
const { extractTrustedDeviceContext } = require('./trustedDeviceChallengeService');
const { sendTransactionalEmail } = require('./email/index');
const { renderActivityTemplate } = require('./email/templates/activityTemplate');
const { maskIpAddress, getDeviceLabelFromUserAgent } = require('./email/templateUtils');
const { enqueueAuthSecurityEvent } = require('./authSecurityEventOutboxService');
const { EMAIL_REGEX } = require('../config/emailFlags');
const logger = require('../utils/logger');

// New-device sign-in alerts (A3). Fires once per unknown device when a
// browser session is established: email + account activity feed +
// telemetry. Never throws and never delays the login response; every
// external call is guarded so alerting can fail without touching auth.

const NEW_DEVICE_EVENT = 'auth.session.new_device';
const NEW_DEVICE_THROTTLE_MS = 24 * 60 * 60 * 1000;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const safeString = (value, fallback = '') => {
    const normalized = String(value || '').trim();
    return normalized || fallback;
};

const isFirstSeenDevice = ({ user = null, deviceId = '' } = {}) => {
    const normalizedDeviceId = String(deviceId || '').trim();
    if (!normalizedDeviceId || !Array.isArray(user?.trustedDevices)) return false;
    return !user.trustedDevices.some(
        (device) => String(device?.deviceId || '').trim() === normalizedDeviceId
    );
};

const wasAlertedRecently = async ({ userId = '', deviceId = '' } = {}) => {
    try {
        const since = new Date(Date.now() - NEW_DEVICE_THROTTLE_MS);
        const record = await AuthSecurityEventOutbox.findOne({
            'payload.userId': String(userId || ''),
            'payload.event': NEW_DEVICE_EVENT,
            'payload.meta.deviceId': String(deviceId || ''),
            createdAt: { $gte: since },
        }).lean();
        return Boolean(record);
    } catch {
        // Throttle lookup must never silence the alert on store errors:
        // fail open toward notifying.
        return false;
    }
};

const notifyNewDeviceSignIn = async ({ req = {}, user = null, deviceId = '' } = {}) => {
    try {
        const resolvedDeviceId = String(
            deviceId || extractTrustedDeviceContext(req).deviceId || ''
        ).trim();
        const recipient = normalizeEmail(user?.email || '');
        if (!resolvedDeviceId || !EMAIL_REGEX.test(recipient) || !user?._id) {
            return { notified: false, reason: 'not_eligible' };
        }
        if (!isFirstSeenDevice({ user, deviceId: resolvedDeviceId })) {
            return { notified: false, reason: 'known_device' };
        }
        if (await wasAlertedRecently({ userId: String(user._id), deviceId: resolvedDeviceId })) {
            return { notified: false, reason: 'throttled' };
        }

        const requestId = String(req.requestId || req.headers?.['x-request-id'] || '');
        const ip = String(req.ip || req.socket?.remoteAddress || '');
        const userAgent = String(req.headers?.['user-agent'] || '');
        const template = renderActivityTemplate({
            brand: 'AURA',
            userName: user?.name || recipient.split('@')[0] || 'there',
            actionTitle: 'New device signed in',
            actionSummary: 'A browser session just signed in from a device we have not seen on your account. If this was you, no action is needed — consider trusting this device. If not, open your sessions and revoke everything you do not recognize.',
            highlights: [
                `Device: ${safeString(getDeviceLabelFromUserAgent(userAgent), 'Unknown device')}`,
                `Network: ${safeString(maskIpAddress(ip), 'Unavailable')}`,
                `Time: ${new Date().toISOString()}`,
            ],
            requestId,
            method: String(req.method || 'POST'),
            path: String(req.originalUrl || req.path || '/api/auth/sync'),
            deviceLabel: getDeviceLabelFromUserAgent(userAgent),
            maskedIp: maskIpAddress(ip),
            occurredAt: new Date(),
            ctaLabel: 'Review active sessions',
        });

        await sendTransactionalEmail({
            eventType: 'user_activity',
            to: recipient,
            subject: template.subject,
            html: template.html,
            text: template.text,
            requestId,
            headers: { 'X-Aura-New-Device': 'true' },
            meta: {
                deviceId: resolvedDeviceId,
                targetUserId: String(user._id),
            },
            securityTags: ['new-device-sign-in'],
        });

        await enqueueAuthSecurityEvent({
            event: NEW_DEVICE_EVENT,
            outcome: 'success',
            reason: 'first_seen_device',
            surface: 'auth',
            userId: String(user._id),
            requestId,
            meta: { deviceId: resolvedDeviceId },
        });

        writeSecurityEvent({
            event: NEW_DEVICE_EVENT,
            outcome: 'success',
            reason: 'first_seen_device',
            surface: 'auth',
            req,
            action: 'session',
            riskScore: 30,
            decision: 'NOTIFY',
            reasonCode: 'new_device_sign_in',
            metadata: { deviceId: resolvedDeviceId },
        }, { level: 'info' });

        logger.info('auth.new_device_sign_in.notified', {
            requestId,
            recipient: recipient.replace(/(.{2}).*(@.*)/, '$1***$2'),
        });

        return { notified: true };
    } catch (error) {
        logger.warn('auth.new_device_sign_in.failed', { error: error?.message || 'unknown' });
        return { notified: false, reason: 'error' };
    }
};

module.exports = {
    NEW_DEVICE_EVENT,
    NEW_DEVICE_THROTTLE_MS,
    isFirstSeenDevice,
    notifyNewDeviceSignIn,
};
