const Order = require('../models/Order');
const PaymentIntent = require('../models/PaymentIntent');
const Listing = require('../models/Listing');
const User = require('../models/User');
const AdminNotification = require('../models/AdminNotification');
const AppError = require('../utils/AppError');

const ADMIN_ANALYTICS_TIMEZONE = process.env.ADMIN_ANALYTICS_TIMEZONE || 'Asia/Kolkata';
const MAX_CUSTOM_RANGE_DAYS = 365;
const RANGE_MAP_MS = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '90d': 90 * 24 * 60 * 60 * 1000,
};

const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const round2 = (value) => Math.round(toNumber(value) * 100) / 100;

const pctDelta = (current, previous) => {
    const cur = toNumber(current, 0);
    const prev = toNumber(previous, 0);
    if (prev <= 0 && cur <= 0) return 0;
    if (prev <= 0 && cur > 0) return 100;
    return round2(((cur - prev) / prev) * 100);
};

const parseDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
};

const resolveDateRange = (query = {}) => {
    const now = new Date();
    const rangeKey = String(query.range || '30d').trim().toLowerCase();
    let start = null;
    let end = null;
    let resolvedRange = rangeKey;

    if (rangeKey === 'custom') {
        start = parseDate(query.from);
        end = parseDate(query.to);
        if (!start || !end) {
            throw new AppError('Custom range requires valid from and to timestamps', 400);
        }
        if (start >= end) {
            throw new AppError('Custom range requires from < to', 400);
        }
        const maxRangeMs = MAX_CUSTOM_RANGE_DAYS * 24 * 60 * 60 * 1000;
        if ((end.getTime() - start.getTime()) > maxRangeMs) {
            throw new AppError(`Custom range cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days`, 400);
        }
    } else if (RANGE_MAP_MS[rangeKey]) {
        end = now;
        start = new Date(now.getTime() - RANGE_MAP_MS[rangeKey]);
    } else {
        resolvedRange = '30d';
        end = now;
        start = new Date(now.getTime() - RANGE_MAP_MS['30d']);
    }

    return {
        rangeKey: resolvedRange,
        start,
        end,
        durationMs: end.getTime() - start.getTime(),
    };
};

const getPreviousRange = ({ start, durationMs }) => {
    const previousEnd = new Date(start.getTime());
    const previousStart = new Date(start.getTime() - durationMs);
    return { previousStart, previousEnd };
};

const aggregateOrderSummary = async (start, end) => {
    const [row] = await Order.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end } } },
        {
            $group: {
                _id: null,
                totalOrders: { $sum: 1 },
                grossRevenue: { $sum: '$totalPrice' },
                avgOrderValue: { $avg: '$totalPrice' },
                cancelledOrders: {
                    $sum: {
                        $cond: [{ $eq: ['$orderStatus', 'cancelled'] }, 1, 0],
                    },
                },
                deliveredOrders: {
                    $sum: {
                        $cond: [{ $eq: ['$orderStatus', 'delivered'] }, 1, 0],
                    },
                },
                processingOrders: {
                    $sum: {
                        $cond: [{ $eq: ['$orderStatus', 'processing'] }, 1, 0],
                    },
                },
            },
        },
    ]);

    return {
        totalOrders: toNumber(row?.totalOrders, 0),
        grossRevenue: round2(row?.grossRevenue || 0),
        avgOrderValue: round2(row?.avgOrderValue || 0),
        cancelledOrders: toNumber(row?.cancelledOrders, 0),
        deliveredOrders: toNumber(row?.deliveredOrders, 0),
        processingOrders: toNumber(row?.processingOrders, 0),
    };
};

const aggregateRefundSummary = async (start, end) => {
    const [row] = await Order.aggregate([
        { $unwind: { path: '$commandCenter.refunds', preserveNullAndEmptyArrays: false } },
        {
            $match: {
                'commandCenter.refunds.createdAt': { $gte: start, $lte: end },
            },
        },
        {
            $group: {
                _id: null,
                totalRefundRequests: { $sum: 1 },
                totalRefundAmount: { $sum: '$commandCenter.refunds.amount' },
                processedRefunds: {
                    $sum: {
                        $cond: [{ $eq: ['$commandCenter.refunds.status', 'processed'] }, 1, 0],
                    },
                },
                rejectedRefunds: {
                    $sum: {
                        $cond: [{ $eq: ['$commandCenter.refunds.status', 'rejected'] }, 1, 0],
                    },
                },
            },
        },
    ]);

    return {
        totalRefundRequests: toNumber(row?.totalRefundRequests, 0),
        totalRefundAmount: round2(row?.totalRefundAmount || 0),
        processedRefunds: toNumber(row?.processedRefunds, 0),
        rejectedRefunds: toNumber(row?.rejectedRefunds, 0),
    };
};

const aggregatePaymentSummary = async (start, end) => {
    const [row] = await PaymentIntent.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end } } },
        {
            $group: {
                _id: null,
                totalIntents: { $sum: 1 },
                failedPayments: {
                    $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
                },
                capturedPayments: {
                    $sum: { $cond: [{ $eq: ['$status', 'captured'] }, 1, 0] },
                },
                authorizedPayments: {
                    $sum: { $cond: [{ $eq: ['$status', 'authorized'] }, 1, 0] },
                },
                capturedAmount: {
                    $sum: {
                        $cond: [{ $eq: ['$status', 'captured'] }, '$amount', 0],
                    },
                },
            },
        },
    ]);

    return {
        totalIntents: toNumber(row?.totalIntents, 0),
        failedPayments: toNumber(row?.failedPayments, 0),
        capturedPayments: toNumber(row?.capturedPayments, 0),
        authorizedPayments: toNumber(row?.authorizedPayments, 0),
        capturedAmount: round2(row?.capturedAmount || 0),
    };
};

const aggregateListingSummary = async (start, end) => {
    const [windowSummary, activeListings, escrowHeld] = await Promise.all([
        Listing.aggregate([
            { $match: { createdAt: { $gte: start, $lte: end } } },
            {
                $group: {
                    _id: null,
                    totalListings: { $sum: 1 },
                    soldListings: { $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] } },
                    avgPrice: { $avg: '$price' },
                },
            },
        ]),
        Listing.countDocuments({ status: 'active' }),
        Listing.countDocuments({ 'escrow.state': 'held' }),
    ]);

    const row = windowSummary[0] || {};
    return {
        totalListings: toNumber(row.totalListings, 0),
        soldListings: toNumber(row.soldListings, 0),
        avgPrice: round2(row.avgPrice || 0),
        activeListings: toNumber(activeListings, 0),
        escrowHeld: toNumber(escrowHeld, 0),
    };
};

const aggregateUserSummary = async (start, end) => {
    const [windowSummary, totalVerified, totalSellers] = await Promise.all([
        User.aggregate([
            { $match: { createdAt: { $gte: start, $lte: end } } },
            {
                $group: {
                    _id: null,
                    newUsers: { $sum: 1 },
                    newVerifiedUsers: {
                        $sum: { $cond: [{ $eq: ['$isVerified', true] }, 1, 0] },
                    },
                },
            },
        ]),
        User.countDocuments({ isVerified: true }),
        User.countDocuments({ isSeller: true }),
    ]);

    const row = windowSummary[0] || {};
    return {
        newUsers: toNumber(row.newUsers, 0),
        newVerifiedUsers: toNumber(row.newVerifiedUsers, 0),
        totalVerified: toNumber(totalVerified, 0),
        totalSellers: toNumber(totalSellers, 0),
    };
};

const aggregateSignalSummary = async (start, end) => {
    const [totalSignals, criticalSignals, unreadSignals] = await Promise.all([
        AdminNotification.countDocuments({ createdAt: { $gte: start, $lte: end } }),
        AdminNotification.countDocuments({ createdAt: { $gte: start, $lte: end }, severity: 'critical' }),
        AdminNotification.countDocuments({ isRead: false }),
    ]);

    return {
        totalSignals: toNumber(totalSignals, 0),
        criticalSignals: toNumber(criticalSignals, 0),
        unreadSignals: toNumber(unreadSignals, 0),
    };
};

const getOverviewMetrics = async (query = {}) => {
    const range = resolveDateRange(query);
    const previousRange = getPreviousRange(range);

    const [
        orders,
        refunds,
        payments,
        listings,
        users,
        signals,
        prevOrders,
        prevPayments,
        prevUsers,
    ] = await Promise.all([
        aggregateOrderSummary(range.start, range.end),
        aggregateRefundSummary(range.start, range.end),
        aggregatePaymentSummary(range.start, range.end),
        aggregateListingSummary(range.start, range.end),
        aggregateUserSummary(range.start, range.end),
        aggregateSignalSummary(range.start, range.end),
        aggregateOrderSummary(previousRange.previousStart, previousRange.previousEnd),
        aggregatePaymentSummary(previousRange.previousStart, previousRange.previousEnd),
        aggregateUserSummary(previousRange.previousStart, previousRange.previousEnd),
    ]);

    return {
        range: {
            key: range.rangeKey,
            start: range.start.toISOString(),
            end: range.end.toISOString(),
            timezone: ADMIN_ANALYTICS_TIMEZONE,
        },
        overview: {
            orders,
            refunds,
            payments,
            listings,
            users,
            signals,
        },
        deltas: {
            ordersPct: pctDelta(orders.totalOrders, prevOrders.totalOrders),
            revenuePct: pctDelta(orders.grossRevenue, prevOrders.grossRevenue),
            paymentFailuresPct: pctDelta(payments.failedPayments, prevPayments.failedPayments),
            newUsersPct: pctDelta(users.newUsers, prevUsers.newUsers),
        },
    };
};

const resolveGranularity = (query = {}, durationMs = 0) => {
    const requested = String(query.granularity || '').trim().toLowerCase();
    if (requested === 'hour' || requested === 'day') return requested;
    return durationMs <= (2 * 24 * 60 * 60 * 1000) ? 'hour' : 'day';
};

const bucketFormat = (granularity) => (granularity === 'hour' ? '%Y-%m-%d %H:00' : '%Y-%m-%d');

const mapSeriesRows = (rows = [], metricMap = {}) => {
    const map = new Map();
    rows.forEach((row) => {
        const key = String(row._id || '');
        if (!key) return;
        if (!map.has(key)) map.set(key, {});
        const target = map.get(key);
        Object.entries(metricMap).forEach(([field, alias]) => {
            target[alias] = toNumber(row[field], 0);
        });
    });
    return map;
};

const mergeSeriesMaps = (maps = []) => {
    const allKeys = new Set();
    maps.forEach((m) => m.forEach((_, key) => allKeys.add(key)));
    return [...allKeys].sort().map((bucket) => {
        const merged = { bucket };
        maps.forEach((m) => {
            const row = m.get(bucket) || {};
            Object.assign(merged, row);
        });
        return merged;
    });
};

const getTimeSeriesMetrics = async (query = {}) => {
    const range = resolveDateRange(query);
    const granularity = resolveGranularity(query, range.durationMs);
    const format = bucketFormat(granularity);

    const [
        ordersSeries,
        paymentFailuresSeries,
        refundSeries,
        listingSeries,
    ] = await Promise.all([
        Order.aggregate([
            { $match: { createdAt: { $gte: range.start, $lte: range.end } } },
            {
                $group: {
                    _id: { $dateToString: { format, date: '$createdAt', timezone: ADMIN_ANALYTICS_TIMEZONE } },
                    orders: { $sum: 1 },
                    revenue: { $sum: '$totalPrice' },
                },
            },
            { $sort: { _id: 1 } },
        ]),
        PaymentIntent.aggregate([
            {
                $match: {
                    createdAt: { $gte: range.start, $lte: range.end },
                    status: 'failed',
                },
            },
            {
                $group: {
                    _id: { $dateToString: { format, date: '$createdAt', timezone: ADMIN_ANALYTICS_TIMEZONE } },
                    failedPayments: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ]),
        Order.aggregate([
            { $unwind: { path: '$commandCenter.refunds', preserveNullAndEmptyArrays: false } },
            {
                $match: {
                    'commandCenter.refunds.createdAt': { $gte: range.start, $lte: range.end },
                },
            },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format,
                            date: '$commandCenter.refunds.createdAt',
                            timezone: ADMIN_ANALYTICS_TIMEZONE,
                        },
                    },
                    refundRequests: { $sum: 1 },
                    refundAmount: { $sum: '$commandCenter.refunds.amount' },
                },
            },
            { $sort: { _id: 1 } },
        ]),
        Listing.aggregate([
            { $match: { createdAt: { $gte: range.start, $lte: range.end } } },
            {
                $group: {
                    _id: { $dateToString: { format, date: '$createdAt', timezone: ADMIN_ANALYTICS_TIMEZONE } },
                    newListings: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ]),
    ]);

    const points = mergeSeriesMaps([
        mapSeriesRows(ordersSeries, { orders: 'orders', revenue: 'revenue' }),
        mapSeriesRows(paymentFailuresSeries, { failedPayments: 'failedPayments' }),
        mapSeriesRows(refundSeries, { refundRequests: 'refundRequests', refundAmount: 'refundAmount' }),
        mapSeriesRows(listingSeries, { newListings: 'newListings' }),
    ]).map((point) => ({
        bucket: point.bucket,
        orders: toNumber(point.orders, 0),
        revenue: round2(point.revenue || 0),
        failedPayments: toNumber(point.failedPayments, 0),
        refundRequests: toNumber(point.refundRequests, 0),
        refundAmount: round2(point.refundAmount || 0),
        newListings: toNumber(point.newListings, 0),
    }));

    return {
        range: {
            key: range.rangeKey,
            start: range.start.toISOString(),
            end: range.end.toISOString(),
            timezone: ADMIN_ANALYTICS_TIMEZONE,
        },
        granularity,
        points,
    };
};

const countRefundRequestsBetween = async (start, end) => {
    const rows = await Order.aggregate([
        { $unwind: { path: '$commandCenter.refunds', preserveNullAndEmptyArrays: false } },
        { $match: { 'commandCenter.refunds.createdAt': { $gte: start, $lte: end } } },
        { $group: { _id: null, count: { $sum: 1 } } },
    ]);
    return toNumber(rows[0]?.count, 0);
};

const detectAnomalies = async (options = {}) => {
    const now = new Date();
    const windowMinutes = Math.max(toNumber(options.windowMinutes, 60), 15);
    const windowMs = windowMinutes * 60 * 1000;
    const currentStart = new Date(now.getTime() - windowMs);
    const baselineStart = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const baselineEnd = currentStart;
    const baselineHours = Math.max((baselineEnd.getTime() - baselineStart.getTime()) / (60 * 60 * 1000), 1);

    const [
        currentOrders,
        baselineOrders,
        currentFailedPayments,
        baselineFailedPayments,
        currentRefundRequests,
        baselineRefundRequests,
        currentCriticalSignals,
        baselineCriticalSignals,
    ] = await Promise.all([
        Order.countDocuments({ createdAt: { $gte: currentStart, $lte: now } }),
        Order.countDocuments({ createdAt: { $gte: baselineStart, $lt: baselineEnd } }),
        PaymentIntent.countDocuments({ createdAt: { $gte: currentStart, $lte: now }, status: 'failed' }),
        PaymentIntent.countDocuments({ createdAt: { $gte: baselineStart, $lt: baselineEnd }, status: 'failed' }),
        countRefundRequestsBetween(currentStart, now),
        countRefundRequestsBetween(baselineStart, baselineEnd),
        AdminNotification.countDocuments({ createdAt: { $gte: currentStart, $lte: now }, severity: 'critical' }),
        AdminNotification.countDocuments({ createdAt: { $gte: baselineStart, $lt: baselineEnd }, severity: 'critical' }),
    ]);

    const metrics = [
        {
            key: 'orders_spike',
            title: 'Order volume spike',
            severity: 'warning',
            current: currentOrders,
            baselineHourly: baselineOrders / baselineHours,
            minCurrent: 20,
            minRatio: 2.2,
            recommendation: 'Verify checkout latency and inventory reservation health.',
        },
        {
            key: 'payment_failures_spike',
            title: 'Payment failures spike',
            severity: 'critical',
            current: currentFailedPayments,
            baselineHourly: baselineFailedPayments / baselineHours,
            minCurrent: 5,
            minRatio: 2.0,
            recommendation: 'Inspect payment gateway errors and signature verification failures immediately.',
        },
        {
            key: 'refund_requests_spike',
            title: 'Refund request spike',
            severity: 'critical',
            current: currentRefundRequests,
            baselineHourly: baselineRefundRequests / baselineHours,
            minCurrent: 4,
            minRatio: 2.0,
            recommendation: 'Audit delivery quality and payment disputes in the command center.',
        },
        {
            key: 'critical_signal_spike',
            title: 'Critical signal spike',
            severity: 'warning',
            current: currentCriticalSignals,
            baselineHourly: baselineCriticalSignals / baselineHours,
            minCurrent: 4,
            minRatio: 1.8,
            recommendation: 'Review latest admin critical notifications and escalate incident response.',
        },
    ];

    const anomalies = metrics
        .map((metric) => {
            const baselinePerWindow = metric.baselineHourly * (windowMinutes / 60);
            const ratio = metric.current / Math.max(baselinePerWindow, 1);
            return {
                key: metric.key,
                title: metric.title,
                severity: metric.severity,
                currentCount: metric.current,
                baselineExpected: round2(baselinePerWindow),
                ratio: round2(ratio),
                windowMinutes,
                recommendation: metric.recommendation,
                triggered: metric.current >= metric.minCurrent && ratio >= metric.minRatio,
            };
        })
        .filter((entry) => entry.triggered)
        .map(({ triggered, ...rest }) => rest);

    return {
        scannedAt: now.toISOString(),
        windowMinutes,
        anomalies,
    };
};

const escapeCsvValue = (value) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
};

const rowsToCsv = (rows = []) => {
    if (!Array.isArray(rows) || rows.length === 0) return '';
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
    const header = keys.join(',');
    const body = rows.map((row) => keys.map((key) => escapeCsvValue(row[key])).join(',')).join('\n');
    return `${header}\n${body}`;
};

const toCsvRows = async (dataset, range, limit) => {
    switch (dataset) {
        case 'orders': {
            const orders = await Order.find(
                { createdAt: { $gte: range.start, $lte: range.end } },
                {
                    _id: 1,
                    user: 1,
                    totalPrice: 1,
                    paymentMethod: 1,
                    orderStatus: 1,
                    paymentState: 1,
                    createdAt: 1,
                }
            )
                .sort({ createdAt: -1 })
                .limit(limit)
                .lean();

            return orders.map((item) => ({
                orderId: String(item._id || ''),
                userId: String(item.user || ''),
                totalPrice: toNumber(item.totalPrice, 0),
                paymentMethod: item.paymentMethod || '',
                paymentState: item.paymentState || '',
                orderStatus: item.orderStatus || '',
                createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : '',
            }));
        }
        case 'payments': {
            const payments = await PaymentIntent.find(
                { createdAt: { $gte: range.start, $lte: range.end } },
                {
                    intentId: 1,
                    user: 1,
                    amount: 1,
                    method: 1,
                    provider: 1,
                    status: 1,
                    createdAt: 1,
                }
            )
                .sort({ createdAt: -1 })
                .limit(limit)
                .lean();

            return payments.map((item) => ({
                intentId: item.intentId || '',
                userId: String(item.user || ''),
                amount: toNumber(item.amount, 0),
                method: item.method || '',
                provider: item.provider || '',
                status: item.status || '',
                createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : '',
            }));
        }
        case 'listings': {
            const listings = await Listing.find(
                { createdAt: { $gte: range.start, $lte: range.end } },
                {
                    _id: 1,
                    seller: 1,
                    title: 1,
                    category: 1,
                    status: 1,
                    price: 1,
                    views: 1,
                    createdAt: 1,
                }
            )
                .sort({ createdAt: -1 })
                .limit(limit)
                .lean();

            return listings.map((item) => ({
                listingId: String(item._id || ''),
                sellerId: String(item.seller || ''),
                title: item.title || '',
                category: item.category || '',
                status: item.status || '',
                price: toNumber(item.price, 0),
                views: toNumber(item.views, 0),
                createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : '',
            }));
        }
        case 'notifications': {
            const entries = await AdminNotification.find(
                { createdAt: { $gte: range.start, $lte: range.end } },
                {
                    notificationId: 1,
                    source: 1,
                    actionKey: 1,
                    severity: 1,
                    title: 1,
                    actorEmail: 1,
                    path: 1,
                    statusCode: 1,
                    isRead: 1,
                    createdAt: 1,
                }
            )
                .sort({ createdAt: -1 })
                .limit(limit)
                .lean();

            return entries.map((item) => ({
                notificationId: item.notificationId || '',
                source: item.source || '',
                actionKey: item.actionKey || '',
                severity: item.severity || '',
                title: item.title || '',
                actorEmail: item.actorEmail || '',
                path: item.path || '',
                statusCode: toNumber(item.statusCode, 0),
                isRead: Boolean(item.isRead),
                createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : '',
            }));
        }
        default: {
            const overview = await getOverviewMetrics({ range: range.rangeKey, from: range.start, to: range.end });
            const rows = [];
            Object.entries(overview.overview).forEach(([section, values]) => {
                Object.entries(values || {}).forEach(([metric, value]) => {
                    rows.push({
                        section,
                        metric,
                        value: typeof value === 'number' ? round2(value) : value,
                        rangeStart: overview.range.start,
                        rangeEnd: overview.range.end,
                    });
                });
            });
            return rows;
        }
    }
};

const getCsvExport = async (query = {}) => {
    const range = resolveDateRange(query);
    const dataset = String(query.dataset || 'overview').trim().toLowerCase();
    const limit = Math.min(Math.max(toNumber(query.limit, 1000), 1), 5000);
    const rows = await toCsvRows(dataset, range, limit);
    const csv = rowsToCsv(rows);
    return {
        dataset,
        filename: `admin_${dataset}_${new Date().toISOString().slice(0, 10)}.csv`,
        csv,
        rowCount: rows.length,
        range: {
            key: range.rangeKey,
            start: range.start.toISOString(),
            end: range.end.toISOString(),
            timezone: ADMIN_ANALYTICS_TIMEZONE,
        },
    };
};

const getBiConfig = () => ({
    mode: String(process.env.ADMIN_BI_MODE || 'hybrid').toLowerCase(),
    powerBi: {
        enabled: String(process.env.ADMIN_POWERBI_ENABLED || 'false').toLowerCase() === 'true',
        workspaceLabel: process.env.ADMIN_POWERBI_WORKSPACE_LABEL || 'Executive BI',
        dashboardUrl: process.env.ADMIN_POWERBI_DASHBOARD_URL || '',
    },
    native: {
        enabled: true,
        dashboardPath: '/admin/dashboard',
    },
});

module.exports = {
    resolveDateRange,
    getOverviewMetrics,
    getTimeSeriesMetrics,
    detectAnomalies,
    getCsvExport,
    getBiConfig,
};
