const express = require('express');
const router = express.Router();
const { protect, seller, requireActiveAccount } = require('../middleware/authMiddleware');
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
router.post('/', protect, requireActiveAccount, seller, createListing);
router.get('/:id/messages', protect, getListingMessages);
router.post('/:id/messages', protect, requireActiveAccount, sendListingMessage);

// Parameterized routes
router.get('/:id', getListingById);
router.put('/:id', protect, requireActiveAccount, seller, updateListing);
router.patch('/:id/sold', protect, requireActiveAccount, seller, markSold);
router.post('/:id/escrow/intents', protect, requireActiveAccount, createEscrowIntent);
router.post('/:id/escrow/intents/:intentId/confirm', protect, requireActiveAccount, confirmEscrowIntent);
router.patch('/:id/escrow/start', protect, requireActiveAccount, startEscrow);
router.patch('/:id/escrow/confirm', protect, requireActiveAccount, confirmEscrowDelivery);
router.patch('/:id/escrow/cancel', protect, requireActiveAccount, cancelEscrow);
router.delete('/:id', protect, requireActiveAccount, seller, deleteListing);

module.exports = router;
