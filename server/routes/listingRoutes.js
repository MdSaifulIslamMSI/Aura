const express = require('express');
const router = express.Router();
const { protect, protectOptional, seller, requireActiveAccount } = require('../middleware/authMiddleware');
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

// Public routes
router.get('/', getListings);
router.get('/hotspots', getCityHotspots);
router.get('/seller/:userId', getSellerProfile);

// Protected routes (must be before /:id)
router.get('/my', protect, seller, getMyListings);
router.get('/messages/inbox', protect, getMyMessageInbox);
router.post('/', protect, requireActiveAccount, seller, sensitiveActions.listingWrite, createListing);
router.get('/:id/messages', protect, getListingMessages);
router.post('/:id/messages', protect, requireActiveAccount, sendListingMessage);
router.post('/:id/video/start', protect, requireActiveAccount, startListingVideoSession);
router.post('/:id/video/join', protect, requireActiveAccount, joinListingVideoSession);
router.post('/:id/video/connected', protect, requireActiveAccount, connectListingVideoSession);
router.post('/:id/video/end', protect, requireActiveAccount, endListingVideoSession);

// Parameterized routes
router.get('/:id', protectOptional, getListingById);
router.put('/:id', protect, requireActiveAccount, seller, authorizeListingOwner('listing.update'), sensitiveActions.listingWrite, updateListing);
router.patch('/:id/sold', protect, requireActiveAccount, seller, authorizeListingOwner('listing.mark_sold'), sensitiveActions.listingWrite, markSold);
router.post('/:id/escrow/intents', protect, requireActiveAccount, sensitiveActions.listingEscrowChange, createEscrowIntent);
router.post('/:id/escrow/intents/:intentId/confirm', protect, requireActiveAccount, sensitiveActions.listingEscrowChange, confirmEscrowIntent);
router.patch('/:id/escrow/start', protect, requireActiveAccount, sensitiveActions.listingEscrowChange, startEscrow);
router.patch('/:id/escrow/confirm', protect, requireActiveAccount, sensitiveActions.listingEscrowChange, confirmEscrowDelivery);
router.patch('/:id/escrow/cancel', protect, requireActiveAccount, sensitiveActions.listingEscrowChange, cancelEscrow);
router.delete('/:id', protect, requireActiveAccount, seller, authorizeListingOwner('listing.delete'), sensitiveActions.listingWrite, deleteListing);

module.exports = router;
