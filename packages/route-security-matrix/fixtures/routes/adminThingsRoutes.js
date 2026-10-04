const router = require('express').Router();

router.post('/', (req, res) => res.status(403).json({ error: 'admin required' }));

module.exports = router;
