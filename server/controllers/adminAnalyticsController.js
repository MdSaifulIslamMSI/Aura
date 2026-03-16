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
    // CRITICAL: Validate export parameters to prevent DOS attacks
    const range = String(req.query.range || '30d').trim();
    const validRanges = ['24h', '7d', '30d', '90d', 'custom'];
    
    if (!validRanges.includes(range)) {
        return next(new AppError('Invalid range parameter', 400));
    }
    
    if (range === 'custom') {
        const from = req.query.from ? new Date(req.query.from).getTime() : NaN;
        const to = req.query.to ? new Date(req.query.to).getTime() : NaN;
        
        if (!Number.isFinite(from) || !Number.isFinite(to)) {
            return next(new AppError('Custom range requires valid from and to parameters', 400));
        }
        
        // CRITICAL: Limit custom range to prevent huge exports
        if ((to - from) > (365 * 24 * 60 * 60 * 1000)) {
            return next(new AppError('Custom range cannot exceed 365 days', 400));
        }
    }
    
    const data = await getCsvExport(req.query || {});
    
    // CRITICAL: Limit export size to prevent DOS
    const maxExportSize = 100 * 1024 * 1024; // 100MB
    if (Buffer.byteLength(data.csv) > maxExportSize) {
        return next(new AppError('Export size exceeds maximum limit. Try narrowing your date range.', 413));
    }
    
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
