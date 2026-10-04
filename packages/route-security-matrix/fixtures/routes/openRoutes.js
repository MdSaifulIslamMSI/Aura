const router = require('express').Router();

router.post('/ping', (req, res) => res.json({ ok: true }));

module.exports = router;
