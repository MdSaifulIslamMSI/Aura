jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = {
            _id: '69aa0000000000000000admin',
            email: 'admin@example.com',
            isAdmin: true,
        };
        req.authToken = {
            email_verified: true,
            auth_time: Math.floor(Date.now() / 1000),
        };
        return next();
    },
    admin: (req, res, next) => next(),
}));

jest.mock('../models/AdminNotification', () => ({
    countDocuments: jest.fn(),
    aggregate: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    updateMany: jest.fn(),
}));

jest.mock('../models/User', () => ({
    countDocuments: jest.fn(),
}));

jest.mock('../models/Order', () => ({
    countDocuments: jest.fn(),
}));

jest.mock('../models/Listing', () => ({
    countDocuments: jest.fn(),
}));

jest.mock('../models/PaymentIntent', () => ({
    countDocuments: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const adminNotificationRoutes = require('../routes/adminNotificationRoutes');
const { errorHandler, notFound } = require('../middleware/errorMiddleware');
const AdminNotification = require('../models/AdminNotification');
const User = require('../models/User');
const Order = require('../models/Order');
const Listing = require('../models/Listing');
const PaymentIntent = require('../models/PaymentIntent');

const makeNotificationDoc = (overrides = {}) => ({
    notificationId: 'notif_0001',
    source: 'system',
    actionKey: 'orders.refund.requested',
    title: 'Refund request pending',
    summary: 'A user requested a refund.',
    severity: 'warning',
    method: 'POST',
    path: '/api/orders/123/command-center/refund',
    statusCode: 200,
    durationMs: 44,
    actorUser: '69aa00000000000000000001',
    actorName: 'Target User',
    actorEmail: 'target@example.com',
    actorRole: 'customer',
    entityType: 'order',
    entityId: 'order_123',
    highlights: ['Order ID: order_123'],
    requestId: 'req_1',
    isRead: false,
    readAt: null,
    readBy: null,
    createdAt: new Date('2026-03-05T10:00:00.000Z'),
    save: jest.fn().mockResolvedValue(undefined),
    toObject() {
        return {
            notificationId: this.notificationId,
            source: this.source,
            actionKey: this.actionKey,
            title: this.title,
            summary: this.summary,
            severity: this.severity,
            method: this.method,
            path: this.path,
            statusCode: this.statusCode,
            durationMs: this.durationMs,
            actorUser: this.actorUser,
            actorName: this.actorName,
            actorEmail: this.actorEmail,
            actorRole: this.actorRole,
            entityType: this.entityType,
            entityId: this.entityId,
            highlights: this.highlights,
            requestId: this.requestId,
            isRead: this.isRead,
            readAt: this.readAt,
            readBy: this.readBy,
            createdAt: this.createdAt,
        };
    },
    ...overrides,
});

const makeFindChain = (result) => ({
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
});

const buildTestApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/notifications', adminNotificationRoutes);
    app.use(notFound);
    app.use(errorHandler);
    return app;
};

describe('Admin notification routes integration', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = buildTestApp();

        AdminNotification.find.mockReturnValue(makeFindChain([makeNotificationDoc()]));
        AdminNotification.findOne.mockResolvedValue(makeNotificationDoc());
        AdminNotification.updateMany.mockResolvedValue({ modifiedCount: 3 });
        AdminNotification.aggregate.mockResolvedValue([{ _id: 'orders.refund.requested', count: 4 }]);

        AdminNotification.countDocuments
            .mockResolvedValueOnce(7)
            .mockResolvedValueOnce(2)
            .mockResolvedValueOnce(5)
            .mockResolvedValueOnce(9)
            .mockResolvedValueOnce(1);

        User.countDocuments
            .mockResolvedValueOnce(12)
            .mockResolvedValueOnce(8)
            .mockResolvedValueOnce(3);
        Order.countDocuments.mockResolvedValue(18);
        Listing.countDocuments
            .mockResolvedValueOnce(21)
            .mockResolvedValueOnce(11)
            .mockResolvedValueOnce(2);
        PaymentIntent.countDocuments
            .mockResolvedValueOnce(4)
            .mockResolvedValueOnce(6);
    });

    test('GET /api/admin/notifications/summary returns operational summary and latest notifications', async () => {
        const res = await request(app).get('/api/admin/notifications/summary');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.summary).toMatchObject({
            unreadCount: 7,
            criticalUnreadCount: 2,
            createdToday: 5,
            createdLast24h: 9,
            operational: {
                users: { total: 12, verified: 8, sellers: 3 },
                orders: { total: 18 },
                listings: { total: 21, active: 11, escrowHeld: 2 },
                payments: { failed: 4, pending: 6 },
            },
        });
        expect(res.body.summary.topActions).toEqual([
            { actionKey: 'orders.refund.requested', count: 4 },
        ]);
        expect(res.body.summary.latest).toHaveLength(1);
    });

    test('GET /api/admin/notifications returns paginated notifications through the real route', async () => {
        const res = await request(app).get('/api/admin/notifications?page=1&limit=20&severity=warning');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            total: 1,
            page: 1,
            limit: 20,
            pages: 1,
        });
        expect(res.body.notifications).toHaveLength(1);
        expect(res.body.notifications[0].notificationId).toBe('notif_0001');
    });

    test('PATCH /api/admin/notifications/:notificationId/read enforces param validation', async () => {
        const res = await request(app)
            .patch('/api/admin/notifications/short/read')
            .send({ read: true });

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Validation Error');
    });

    test('PATCH /api/admin/notifications/:notificationId/read updates read state through the real route', async () => {
        const notification = makeNotificationDoc();
        AdminNotification.findOne.mockResolvedValue(notification);

        const res = await request(app)
            .patch(`/api/admin/notifications/${notification.notificationId}/read`)
            .send({ read: true });

        expect(res.statusCode).toBe(200);
        expect(notification.isRead).toBe(true);
        expect(String(notification.readBy)).toBe('69aa0000000000000000admin');
        expect(notification.save).toHaveBeenCalled();
        expect(res.body.notification.isRead).toBe(true);
    });

    test('PATCH /api/admin/notifications/read-all marks unread notifications as read', async () => {
        const res = await request(app)
            .patch('/api/admin/notifications/read-all')
            .send({ severity: 'warning' });

        expect(res.statusCode).toBe(200);
        expect(AdminNotification.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ severity: 'warning', isRead: false }),
            expect.any(Object)
        );
        expect(res.body).toEqual({
            success: true,
            updated: 3,
        });
    });
});
