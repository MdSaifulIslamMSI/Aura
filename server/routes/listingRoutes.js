const express = require('express');
const router = express.Router();
const { protect, protectOptional, seller, requireActiveAccount } = require('../middleware/authMiddleware');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const {
    authorizeListingOwner,
    sensitiveActions,
} = require('../middleware/routeSecurityGuards');
const {
    createListing,
    getListings,
    getListingById,
    updateListing,
    markSold,
    deleteListing,
    getMyListings,
    getSellerProfile,
    getMyMessageInbox,
    getListingMessages,
    sendListingMessage,
    startListingVideoSession,
    joinListingVideoSession,
    connectListingVideoSession,
    endListingVideoSession,
    createEscrowIntent,
    confirmEscrowIntent,
    startEscrow,
    confirmEscrowDelivery,
    cancelEscrow,
    getCityHotspots,
} = require('../controllers/listingController');

const actorRateLimitKey = (req) => (
    req.authUid
    || req.user?._id?.toString()
    || req.user?.id
    || req.user?.email
    || req.ip
);

const listingMutationLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    name: 'listing_mutation',
    securityCritical: true,
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 60,
    keyGenerator: actorRateLimitKey,
    message: 'Too many listing changes. Please try again shortly.',
});

const listingEscrowLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    name: 'listing_escrow',
    securityCritical: true,
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 40,
    keyGenerator: actorRateLimitKey,
    message: 'Too many escrow requests. Please try again shortly.',
});

// Public routes
router.get('/', getListings);
router.get('/hotspots', getCityHotspots);
router.get('/seller/:userId', getSellerProfile);

// Protected routes (must be before /:id)
router.get('/my', protect, seller, getMyListings);
router.get('/messages/inbox', protect, getMyMessageInbox);
router.post('/', protect, requireActiveAccount, seller, listingMutationLimiter, sensitiveActions.listingWrite, createListing);
router.get('/:id/messages', protect, getListingMessages);
router.post('/:id/messages', protect, requireActiveAccount, sendListingMessage);
router.post('/:id/video/start', protect, requireActiveAccount, startListingVideoSession);
router.post('/:id/video/join', protect, requireActiveAccount, joinListingVideoSession);
router.post('/:id/video/connected', protect, requireActiveAccount, connectListingVideoSession);
router.post('/:id/video/end', protect, requireActiveAccount, endListingVideoSession);

// Parameterized routes
router.get('/:id', protectOptional, getListingById);
// Distributed limiter immediately precedes owner authorization.
// codeql[js/missing-rate-limiting]
router.put('/:id', protect, requireActiveAccount, seller, listingMutationLimiter, authorizeListingOwner('listing.update'), sensitiveActions.listingWrite, updateListing);
// Distributed limiter immediately precedes owner authorization.
// codeql[js/missing-rate-limiting]
router.patch('/:id/sold', protect, requireActiveAccount, seller, listingMutationLimiter, authorizeListingOwner('listing.mark_sold'), sensitiveActions.listingWrite, markSold);
router.post('/:id/escrow/intents', protect, requireActiveAccount, listingEscrowLimiter, sensitiveActions.listingEscrowChange, createEscrowIntent);
router.post('/:id/escrow/intents/:intentId/confirm', protect, requireActiveAccount, listingEscrowLimiter, sensitiveActions.listingEscrowChange, confirmEscrowIntent);
router.patch('/:id/escrow/start', protect, requireActiveAccount, listingEscrowLimiter, sensitiveActions.listingEscrowChange, startEscrow);
router.patch('/:id/escrow/confirm', protect, requireActiveAccount, listingEscrowLimiter, sensitiveActions.listingEscrowChange, confirmEscrowDelivery);
router.patch('/:id/escrow/cancel', protect, requireActiveAccount, listingEscrowLimiter, sensitiveActions.listingEscrowChange, cancelEscrow);
// Distributed limiter immediately precedes owner authorization.
// codeql[js/missing-rate-limiting]
router.delete('/:id', protect, requireActiveAccount, seller, listingMutationLimiter, authorizeListingOwner('listing.delete'), sensitiveActions.listingWrite, deleteListing);

module.exports = router;
