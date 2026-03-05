const express = require('express');
const router = express.Router();
const { protect, seller } = require('../middleware/authMiddleware');
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
router.post('/', protect, seller, createListing);
router.get('/:id/messages', protect, getListingMessages);
router.post('/:id/messages', protect, sendListingMessage);

// Parameterized routes
router.get('/:id', getListingById);
router.put('/:id', protect, seller, updateListing);
router.patch('/:id/sold', protect, seller, markSold);
router.post('/:id/escrow/intents', protect, createEscrowIntent);
router.post('/:id/escrow/intents/:intentId/confirm', protect, confirmEscrowIntent);
router.patch('/:id/escrow/start', protect, startEscrow);
router.patch('/:id/escrow/confirm', protect, confirmEscrowDelivery);
router.patch('/:id/escrow/cancel', protect, cancelEscrow);
router.delete('/:id', protect, seller, deleteListing);

module.exports = router;
