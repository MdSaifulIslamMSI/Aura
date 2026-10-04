const router = require('express').Router();

router.post('/otp', (req, res) => res.status(400).json({ error: 'validation failed' }));
router.post('/boom', (req, res) => res.status(500).json({ error: 'unexpected' }));
router.post(`/dynamic/${process.env.NODE_ENV}`, (req, res) => res.json({}));

module.exports = router;
