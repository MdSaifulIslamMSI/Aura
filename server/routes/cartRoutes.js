const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
    getCanonicalCart,
    applyCanonicalCartCommands,
} = require('../controllers/cartController');

router.get('/', protect, getCanonicalCart);
router.post('/commands', protect, applyCanonicalCartCommands);

module.exports = router;
