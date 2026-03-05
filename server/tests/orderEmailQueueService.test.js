const mongoose = require('mongoose');
const OrderEmailNotification = require('../models/OrderEmailNotification');
const {
    buildNotificationDedupeKey,
    computeRetryDelayMs,
    enqueueOrderPlacedEmail,
    EVENT_ORDER_PLACED,
} = require('../services/email/orderEmailQueueService');

describe('Order Email Queue Service', () => {
    beforeEach(async () => {
        await OrderEmailNotification.deleteMany({});
    });

    test('buildNotificationDedupeKey is stable and lowercases recipient', () => {
        const key = buildNotificationDedupeKey({
            orderId: 'abc123',
            eventType: EVENT_ORDER_PLACED,
            recipientEmail: 'User@Example.COM',
        });
        expect(key).toBe('abc123:order_placed:user@example.com');
    });

    test('computeRetryDelayMs applies bounded jitter on schedule', () => {
        const minDelay = computeRetryDelayMs(1, () => 0); // 1 minute * 0.8
        const maxDelay = computeRetryDelayMs(1, () => 1); // 1 minute * 1.2
        expect(minDelay).toBe(48000);
        expect(maxDelay).toBe(72000);
    });

    test('enqueueOrderPlacedEmail dedupes same order/event/recipient', async () => {
        const orderId = new mongoose.Types.ObjectId();
        const userId = new mongoose.Types.ObjectId();

        const baseOrder = {
            _id: orderId,
            user: userId,
            createdAt: new Date(),
            orderItems: [{ title: 'Laptop', quantity: 1, price: 49999 }],
            shippingAddress: { address: 'Main Road', city: 'Pune', postalCode: '411001', country: 'India' },
            paymentMethod: 'COD',
            paymentState: 'pending',
            itemsPrice: 49999,
            shippingPrice: 0,
            taxPrice: 0,
            couponDiscount: 0,
            paymentAdjustment: 0,
            totalPrice: 49999,
            deliveryOption: 'standard',
            checkoutSource: 'cart',
            pricingVersion: 'v2',
        };

        const user = {
            _id: userId,
            name: 'Alice',
            email: 'alice@example.com',
        };

        const first = await enqueueOrderPlacedEmail({ order: baseOrder, user, requestId: 'req-1' });
        const second = await enqueueOrderPlacedEmail({ order: baseOrder, user, requestId: 'req-2' });

        expect(first.notificationId).toBeTruthy();
        expect(second.notificationId).toBe(first.notificationId);
        const count = await OrderEmailNotification.countDocuments({ dedupeKey: first.dedupeKey });
        expect(count).toBe(1);
    });
});
