const express = require('express');
const {
    CANARY_ROUTES,
    isCanaryEnabled,
    recordCanaryTouch,
} = require('../security/canaryService');

const router = express.Router();

const canaryHandler = (req, res) => {
    if (!isCanaryEnabled()) {
        return res.status(404).json({ message: 'Not found' });
    }

    const touch = recordCanaryTouch(req);
    res.set('Cache-Control', 'no-store');
    return res.status(touch.contained ? 403 : 404).json({
        message: 'Not found',
        requestId: req.requestId || '',
    });
};

for (const route of CANARY_ROUTES) {
    router.all(route, canaryHandler);
}

module.exports = router;
