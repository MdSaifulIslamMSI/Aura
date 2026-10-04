const router = require('express').Router();

router.post('/', (req, res) => res.status(401).json({ error: 'auth required' }));
router.post('/:id/adopt', (req, res) => res.status(401).json({ error: 'auth required' }));
router.get('/', (req, res) => res.json({ things: [] }));

module.exports = router;
