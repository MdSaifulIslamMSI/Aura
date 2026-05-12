/**
 * metricsRoute.js — Prometheus scrape endpoint
 *
 * GET /metrics — returns Prometheus text format metrics for scraping.
 * Protected by METRICS_SECRET or CRON_SECRET so the endpoint is not
 * publicly accessible in production. Scrapers may use Authorization:
 * Bearer <secret>, x-metrics-key, or x-metrics-token.
 *
 * In development (NODE_ENV !== 'production') the secret check is skipped
 * for convenience.
 */

const express = require('express');
const { registry, metricsAuth } = require('../middleware/metrics');

const router = express.Router();

router.get('/', metricsAuth, async (req, res, next) => {
    try {
        const metrics = await registry.metrics();
        res.setHeader('Content-Type', registry.contentType);
        return res.status(200).send(metrics);
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
