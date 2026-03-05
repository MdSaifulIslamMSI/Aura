const express = require('express');
const router = express.Router();
const { createPriceAlert, getMyAlerts, deleteAlert, getPriceHistory } = require('../controllers/priceAlertController');
const { protect } = require('../middleware/authMiddleware');

router.post('/', protect, createPriceAlert);
router.get('/my', protect, getMyAlerts);
router.delete('/:id', protect, deleteAlert);
router.get('/history/:productId', getPriceHistory);  // Public

module.exports = router;
