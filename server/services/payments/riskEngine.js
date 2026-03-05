const PaymentIntent = require('../../models/PaymentIntent');

const buildRiskDecision = (score) => {
    if (score >= 70) return 'block';
    if (score >= 40) return 'challenge';
    return 'allow';
};

const evaluateRisk = async ({
    userId,
    amount,
    deviceContext = {},
    requestMeta = {},
    shippingAddress = {},
    mode = 'shadow',
}) => {
    let score = 0;
    const factors = [];
    const now = Date.now();

    const [tenMinAttempts, oneHourAttempts, oneDayFailures, oneHourIpAttempts] = await Promise.all([
        PaymentIntent.countDocuments({ user: userId, createdAt: { $gte: new Date(now - (10 * 60 * 1000)) } }),
        PaymentIntent.countDocuments({ user: userId, createdAt: { $gte: new Date(now - (60 * 60 * 1000)) } }),
        PaymentIntent.countDocuments({
            user: userId,
            status: { $in: ['failed', 'expired'] },
            createdAt: { $gte: new Date(now - (24 * 60 * 60 * 1000)) },
        }),
        requestMeta.ip
            ? PaymentIntent.countDocuments({
                'metadata.ip': requestMeta.ip,
                createdAt: { $gte: new Date(now - (60 * 60 * 1000)) },
            })
            : 0,
    ]);

    if (amount >= 50000) {
        score += 35;
        factors.push('high_amount_50k_plus');
    } else if (amount >= 20000) {
        score += 20;
        factors.push('medium_high_amount_20k_plus');
    }

    if (tenMinAttempts >= 4) {
        score += 25;
        factors.push('high_attempt_velocity_10m');
    } else if (oneHourAttempts >= 8) {
        score += 15;
        factors.push('high_attempt_velocity_1h');
    }

    if (oneHourIpAttempts >= 20) {
        score += 20;
        factors.push('ip_velocity_1h');
    }

    if (oneDayFailures >= 3) {
        score += 20;
        factors.push('recent_failures_24h');
    }

    if (!deviceContext.userAgent) {
        score += 8;
        factors.push('missing_user_agent');
    }
    if (!deviceContext.platform) {
        score += 5;
        factors.push('missing_platform_context');
    }

    if (!shippingAddress?.postalCode || String(shippingAddress.postalCode).trim().length < 6) {
        score += 10;
        factors.push('weak_shipping_postal');
    }

    const strictDecision = buildRiskDecision(score);
    const decision = mode === 'enforce' ? strictDecision : 'allow';
    const challengeRequired = mode === 'enforce' && strictDecision === 'challenge';
    const blocked = mode === 'enforce' && strictDecision === 'block';

    return {
        score,
        factors,
        strictDecision,
        decision,
        challengeRequired,
        blocked,
        mode,
    };
};

module.exports = {
    evaluateRisk,
};

