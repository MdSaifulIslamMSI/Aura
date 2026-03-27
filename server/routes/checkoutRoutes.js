const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getCheckoutRuntimeConfig } = require('../controllers/checkoutController');

router.get('/config', protect, getCheckoutRuntimeConfig);

module.exports = router;
