const express = require('express');
const router = express.Router();
const { estimateTradeIn, createTradeIn, getMyTradeIns, cancelTradeIn } = require('../controllers/tradeInController');
const { protect } = require('../middleware/authMiddleware');

router.post('/estimate', protect, estimateTradeIn);
router.post('/', protect, createTradeIn);
router.get('/my', protect, getMyTradeIns);
router.delete('/:id', protect, cancelTradeIn);

module.exports = router;
