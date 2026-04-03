const express = require('express');
const { requireInternalAiAuth } = require('../middleware/internalAiAuth');
const { runAiTool } = require('../controllers/internalAiToolsController');

const router = express.Router();

router.use(requireInternalAiAuth);
router.post('/run', runAiTool);

module.exports = router;
