const asyncHandler = require('express-async-handler');
const {
    getOverviewMetrics,
    getTimeSeriesMetrics,
    detectAnomalies,
    getCsvExport,
    getBiConfig,
} = require('../services/adminAnalyticsService');

const getAdminAnalyticsOverview = asyncHandler(async (req, res) => {
    const data = await getOverviewMetrics(req.query || {});
    res.json({ success: true, ...data });
});

const getAdminAnalyticsTimeSeries = asyncHandler(async (req, res) => {
    const data = await getTimeSeriesMetrics(req.query || {});
    res.json({ success: true, ...data });
});

const getAdminAnalyticsAnomalies = asyncHandler(async (req, res) => {
    const data = await detectAnomalies(req.query || {});
    res.json({ success: true, ...data });
});

const exportAdminAnalyticsCsv = asyncHandler(async (req, res) => {
    const data = await getCsvExport(req.query || {});
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${data.filename}"`);
    res.setHeader('X-Admin-Export-Row-Count', String(data.rowCount));
    res.status(200).send(data.csv);
});

const getAdminBiConfig = asyncHandler(async (req, res) => {
    const config = getBiConfig();
    res.json({
        success: true,
        config,
    });
});

module.exports = {
    getAdminAnalyticsOverview,
    getAdminAnalyticsTimeSeries,
    getAdminAnalyticsAnomalies,
    exportAdminAnalyticsCsv,
    getAdminBiConfig,
};
