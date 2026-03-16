const User = require('../models/User');
const logger = require('../utils/logger');

const MAINTENANCE_INTERVAL_MS = 30 * 60 * 1000;

const normalizeEmail = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const normalizePhone = (value) => (
    typeof value === 'string' ? value.replace(/\D/g, '') : ''
);

const reconcileDuplicatePendingUsers = async () => {
    const pendingUsers = await User.find({ isVerified: false }, '_id email phone createdAt updatedAt')
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean();

    const groups = new Map();
    for (const user of pendingUsers) {
        const email = normalizeEmail(user.email);
        const phone = normalizePhone(user.phone);
        const keys = [email ? `email:${email}` : '', phone ? `phone:${phone}` : ''].filter(Boolean);
        for (const key of keys) {
            const members = groups.get(key) || [];
            members.push(user);
            groups.set(key, members);
        }
    }

    const duplicateIds = new Set();
    for (const members of groups.values()) {
        if (members.length <= 1) continue;
        const [keep, ...duplicates] = members;
        for (const dup of duplicates) duplicateIds.add(String(dup._id));
        logger.warn('otp.signup_pending_duplicates_detected', {
            keepUserId: String(keep._id),
            duplicateCount: duplicates.length,
        });
    }

    if (duplicateIds.size === 0) return { duplicatesDetected: 0, deleted: 0 };

    const deletionEnabled = String(process.env.OTP_SIGNUP_RECONCILE_DELETE_ENABLED || '').trim().toLowerCase() === 'true';
    if (!deletionEnabled) {
        logger.warn('otp.signup_pending_duplicates_not_deleted', {
            duplicateCount: duplicateIds.size,
            reason: 'OTP_SIGNUP_RECONCILE_DELETE_ENABLED is false',
        });
        return { duplicatesDetected: duplicateIds.size, deleted: 0 };
    }

    const result = await User.deleteMany({ _id: { $in: Array.from(duplicateIds) }, isVerified: false });
    logger.info('otp.signup_pending_duplicates_reconciled', {
        duplicateCount: duplicateIds.size,
        deleted: Number(result?.deletedCount || 0),
    });

    return {
        duplicatesDetected: duplicateIds.size,
        deleted: Number(result?.deletedCount || 0),
    };
};

const startOtpSignupMaintenanceWorker = () => {
    const run = async () => {
        try {
            await reconcileDuplicatePendingUsers();
        } catch (error) {
            logger.warn('otp.signup_pending_reconcile_failed', {
                error: error?.message || 'unknown error',
            });
        }
    };

    run();
    const timer = setInterval(run, MAINTENANCE_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
    logger.info('otp.signup_pending_reconcile_worker_started', {
        intervalMs: MAINTENANCE_INTERVAL_MS,
    });
};

module.exports = {
    reconcileDuplicatePendingUsers,
    startOtpSignupMaintenanceWorker,
};
