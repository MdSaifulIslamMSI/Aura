const router = require('express').Router();

router.post('/receiver', (req, res) => res.status(401).json({ error: 'signature required' }));

module.exports = router;
