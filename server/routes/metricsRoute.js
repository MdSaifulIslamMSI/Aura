/**
 * metricsRoute.js — Prometheus scrape endpoint
 *
 * GET /metrics — returns Prometheus text format metrics for scraping.
 * Protected by CRON_SECRET (same token used for internal job auth) so
 * the endpoint is not publicly accessible in production.
 *
 * In development (NODE_ENV !== 'production') the secret check is skipped
 * for convenience.
 */

const express = require('express');
const { registry } = require('../middleware/metrics');

const router = express.Router();

const metricsSecret = String(process.env.CRON_SECRET || '').trim();
const isProduction = (process.env.NODE_ENV || 'production') === 'production';

router.get('/', async (req, res, next) => {
    try {
        // In production, require the CRON_SECRET header to restrict scraping
        if (isProduction && metricsSecret) {
            const provided = String(req.headers['x-metrics-token'] || req.query.token || '').trim();
            if (provided !== metricsSecret) {
                return res.status(401).json({ status: 'error', message: 'Unauthorized' });
            }
        }

        const metrics = await registry.metrics();
        res.setHeader('Content-Type', registry.contentType);
        return res.status(200).send(metrics);
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
