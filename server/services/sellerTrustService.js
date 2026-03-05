const Listing = require('../models/Listing');

const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);

const riskTierFromMetrics = ({ disputeRate, cancelledEscrow, onTimeRate }) => {
    if (disputeRate >= 0.08 || cancelledEscrow >= 3 || onTimeRate < 45) return 'high';
    if (disputeRate >= 0.035 || cancelledEscrow >= 1 || onTimeRate < 70) return 'medium';
    return 'low';
};

const buildSellerTrustPassport = async ({ sellerId, sellerUser = null }) => {
    const listings = await Listing.find({ seller: sellerId })
        .select('status createdAt soldAt escrow disputeCount')
        .lean();

    const totalListings = listings.length;
    const soldListings = listings.filter((entry) => entry.status === 'sold');
    const activeListings = listings.filter((entry) => entry.status === 'active').length;

    let onTimeSold = 0;
    soldListings.forEach((entry) => {
        const createdAt = entry.createdAt ? new Date(entry.createdAt).getTime() : null;
        const soldAt = entry.soldAt ? new Date(entry.soldAt).getTime() : null;
        if (!createdAt || !soldAt || soldAt <= createdAt) return;
        const days = (soldAt - createdAt) / (1000 * 60 * 60 * 24);
        if (days <= 14) onTimeSold += 1;
    });

    const disputeCount = listings.reduce((sum, entry) => sum + (Number(entry.disputeCount) || 0), 0);
    const escrowReleased = listings.filter((entry) => entry.escrow?.state === 'released').length;
    const escrowCancelled = listings.filter((entry) => entry.escrow?.state === 'cancelled').length;
    const completedTransactions = Math.max(1, soldListings.length + escrowReleased);
    const disputeRate = clamp(disputeCount / completedTransactions, 0, 1);
    const onTimeRate = soldListings.length > 0 ? clamp((onTimeSold / soldListings.length) * 100, 0, 100) : 82;

    const responseSlaHours = totalListings >= 40
        ? 2
        : totalListings >= 20
            ? 4
            : totalListings >= 8
                ? 8
                : 12;

    const fraudRiskTier = riskTierFromMetrics({
        disputeRate,
        cancelledEscrow: escrowCancelled,
        onTimeRate,
    });

    const trustScore = clamp(
        Math.round(
            (onTimeRate * 0.42)
            + ((1 - disputeRate) * 100 * 0.34)
            + ((fraudRiskTier === 'low' ? 100 : fraudRiskTier === 'medium' ? 65 : 30) * 0.24)
        ),
        0,
        100
    );

    const verifiedBadges = [];
    if (sellerUser?.isVerified) verifiedBadges.push('verified_identity');
    if (completedTransactions >= 10 && disputeRate <= 0.02) verifiedBadges.push('trusted_seller');
    if (responseSlaHours <= 4) verifiedBadges.push('fast_response');
    if (escrowReleased >= 3) verifiedBadges.push('escrow_ready');

    return {
        trustScore,
        verifiedBadges,
        disputeRate: Number((disputeRate * 100).toFixed(2)),
        onTimeHistory: Number(onTimeRate.toFixed(2)),
        responseSlaHours,
        fraudRiskTier,
        stats: {
            totalListings,
            activeListings,
            soldListings: soldListings.length,
            disputes: disputeCount,
            escrowReleased,
            escrowCancelled,
        },
    };
};

module.exports = {
    buildSellerTrustPassport,
};
