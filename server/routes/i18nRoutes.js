const express = require('express');
const validate = require('../middleware/validate');
const { translateBatch } = require('../controllers/i18nController');
const { translateBatchSchema } = require('../validators/i18nValidators');

const router = express.Router();

router.post('/translate', validate(translateBatchSchema), translateBatch);

module.exports = router;
