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
const { refreshAccountMigrationMetrics } = require('../services/accountProductTelemetryService');

const router = express.Router();

const waitForDrain = (res) => new Promise((resolve, reject) => {
    const cleanup = () => {
        res.off('drain', onDrain);
        res.off('close', onClose);
    };
    const onDrain = () => {
        cleanup();
        resolve();
    };
    const onClose = () => {
        cleanup();
        reject(new Error('Metrics client disconnected during scrape'));
    };

    res.once('drain', onDrain);
    res.once('close', onClose);
});

const streamRegistryMetrics = async (res, targetRegistry = registry) => {
    const metrics = targetRegistry.getMetricsAsArray();
    res.setHeader('Content-Type', targetRegistry.contentType);
    res.status(200);

    for (let index = 0; index < metrics.length; index += 1) {
        const output = await targetRegistry.getMetricsAsString(metrics[index]);
        const chunk = index === 0 ? output : `\n\n${output}`;
        if (!res.write(chunk)) {
            await waitForDrain(res);
        }
    }

    res.end('\n');
};

router.get('/', metricsAuth, async (req, res, next) => {
    try {
        await refreshAccountMigrationMetrics();
        // prom-client's Registry.metrics() renders every family concurrently and
        // joins all intermediate strings. Stream sequentially to bound scrape heap.
        await streamRegistryMetrics(res);
        return undefined;
    } catch (error) {
        if (res.headersSent) {
            res.destroy(error);
            return undefined;
        }
        return next(error);
    }
});

module.exports = router;
