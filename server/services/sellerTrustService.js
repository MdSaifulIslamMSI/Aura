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

    // A listing marked sold is a SELLER-DECLARED state: markSold writes
    // `status: 'sold'` with no payment, escrow, or order evidence. Only an
    // escrow that was RELEASED carries evidence - the money was captured and
    // delivery was confirmed. The two are counted separately so a seller
    // cannot mint trust, or dilute their own dispute rate, by declaring sales.
    const verifiedSoldListings = listings.filter((entry) => entry.escrow?.state === 'released');
    const declaredSoldListings = soldListings.filter((entry) => entry.escrow?.state !== 'released');
    const verifiedTransactions = verifiedSoldListings.length;

    let onTimeSold = 0;
    verifiedSoldListings.forEach((entry) => {
        const startedAt = entry.escrow?.startedAt ? new Date(entry.escrow.startedAt).getTime() : null;
        const releasedAt = entry.escrow?.releasedAt ? new Date(entry.escrow.releasedAt).getTime() : null;
        if (!startedAt || !releasedAt || releasedAt <= startedAt) return;
        const days = (releasedAt - startedAt) / (1000 * 60 * 60 * 24);
        if (days <= 14) onTimeSold += 1;
    });

    const disputeCount = listings.reduce((sum, entry) => sum + (Number(entry.disputeCount) || 0), 0);
    const escrowReleased = verifiedSoldListings.length;
    // A buyer releasing their own escrow authorization is not a seller
    // failure, so only seller-initiated cancellations count against the
    // seller. Legacy rows carry no cancelledBy and are counted conservatively.
    const escrowCancelled = listings.filter((entry) => (
        entry.escrow?.state === 'cancelled'
        && (!entry.escrow?.cancelledBy || String(entry.escrow.cancelledBy) === String(sellerId))
    )).length;
    // The dispute-rate denominator counts only evidence-backed completions.
    // Including self-declared sales let a seller dilute a real dispute rate
    // by declaring extra sales, which dropped them out of the high-risk tier.
    const completedTransactions = Math.max(1, verifiedTransactions);
    const disputeRate = clamp(disputeCount / completedTransactions, 0, 1);
    const onTimeRate = verifiedSoldListings.length > 0
        ? clamp((onTimeSold / verifiedSoldListings.length) * 100, 0, 100)
        : 82;

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
    // The trusted-seller badge is a trust claim, so it is earned with
    // evidence-backed transactions. A badge that ten mark-sold calls can mint
    // is not a trust signal.
    if (verifiedTransactions >= 10 && disputeRate <= 0.02) verifiedBadges.push('trusted_seller');
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
            verifiedTransactions,
            declaredSoldListings: declaredSoldListings.length,
            disputes: disputeCount,
            escrowReleased,
            escrowCancelled,
        },
    };
};

module.exports = {
    buildSellerTrustPassport,
};
