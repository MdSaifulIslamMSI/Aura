const express = require('express');
const { getBrowseFxRates } = require('../controllers/marketController');

const router = express.Router();

router.get('/fx-rates', getBrowseFxRates);

module.exports = router;
