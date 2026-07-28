jest.mock('../models/Order');
jest.mock('../services/cartService');
jest.mock('../services/authSecurityTelemetryService');

const Order = require('../models/Order');
const {
    applyCartCommands,
    buildLegacyCartResponse,
} = require('../services/cartService');
const { recordAuthSecurityEvent } = require('../services/authSecurityTelemetryService');
const {
    getMyOrders,
    getMyOrderReceipt,
    buyOrderAgain,
} = require('../controllers/orderController');
const {
    getMyOrdersSchema,
    buyAgainSchema,
} = require('../validators/orderValidators');

const ownerId = '507f1f77bcf86cd799439011';
const orderId = '507f191e810c19729de860ea';

const buildResponse = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    attachment: jest.fn().mockReturnThis(),
});

describe('account order history and actions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('strictly validates bounded customer history filters', () => {
        expect(getMyOrdersSchema.parse({
            query: {
                limit: '20',
                status: 'delivered',
                search: orderId,
                createdAfter: '2026-01-01T00:00:00.000Z',
            },
        }).query.limit).toBe(20);

        expect(() => getMyOrdersSchema.parse({
            query: { role: 'admin' },
        })).toThrow();
        expect(() => buyAgainSchema.parse({
            params: { id: orderId },
            body: { price: 1 },
        })).toThrow();
    });

    test('always scopes filtered history to the authenticated owner', async () => {
        const lean = jest.fn().mockResolvedValue([]);
        const limit = jest.fn().mockReturnValue({ lean });
        const sort = jest.fn().mockReturnValue({ limit });
        Order.find.mockReturnValue({ sort });
        const req = {
            user: { _id: ownerId },
            query: {
                status: 'delivered',
                search: orderId,
                createdAfter: '2026-01-01T00:00:00.000Z',
                limit: 20,
            },
        };
        const res = buildResponse();

        await getMyOrders(req, res, jest.fn());

        expect(Order.find).toHaveBeenCalledWith(expect.objectContaining({
            user: ownerId,
            orderStatus: 'delivered',
            _id: expect.anything(),
            createdAt: expect.objectContaining({ $gte: expect.any(Date) }),
        }));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            orders: [],
            pagination: expect.objectContaining({ limit: 20 }),
        }));
    });

    test('builds an owner-scoped no-store receipt with a bounded projection', async () => {
        const receiptOrder = {
            _id: orderId,
            createdAt: new Date('2026-02-01T10:00:00.000Z'),
            orderStatus: 'delivered',
            paymentMethod: 'CARD',
            paymentState: 'paid',
            totalPrice: 1500,
            presentmentCurrency: 'INR',
            orderItems: [{ title: 'Aura Item', quantity: 2, price: 750 }],
            shippingAddress: {
                address: '12 Test Road',
                city: 'Pune',
                postalCode: '411001',
                country: 'India',
            },
        };
        const lean = jest.fn().mockResolvedValue(receiptOrder);
        const select = jest.fn().mockReturnValue({ lean });
        Order.findOne.mockReturnValue({ select });
        const res = buildResponse();
        const next = jest.fn();

        await getMyOrderReceipt({
            params: { id: orderId },
            user: { _id: ownerId },
        }, res, next);

        expect(Order.findOne).toHaveBeenCalledWith({ _id: orderId, user: ownerId });
        expect(select).toHaveBeenCalledWith(expect.not.stringContaining('paymentIntentId'));
        expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            version: 1,
            orderId,
            amount: expect.objectContaining({ currency: 'INR' }),
        }));
        expect(next).not.toHaveBeenCalled();
    });

    test('reconstructs buy-again commands from server-owned order rows only', async () => {
        const lean = jest.fn().mockResolvedValue({
            _id: orderId,
            orderItems: [{
                product: { id: 44001 },
                quantity: 2,
            }],
        });
        const populate = jest.fn().mockReturnValue({ lean });
        const select = jest.fn().mockReturnValue({ populate });
        Order.findOne.mockReturnValue({ select });
        applyCartCommands.mockResolvedValue({
            conflict: false,
            duplicate: false,
            cart: { version: 4, items: [] },
        });
        buildLegacyCartResponse.mockReturnValue({ version: 4, items: [] });
        const res = buildResponse();
        const next = jest.fn();

        await buyOrderAgain({
            params: { id: orderId },
            user: { _id: ownerId },
            body: { expectedCartVersion: 3 },
            headers: { 'idempotency-key': 'buy-again-safe-key' },
        }, res, next);

        expect(Order.findOne).toHaveBeenCalledWith({ _id: orderId, user: ownerId });
        expect(applyCartCommands).toHaveBeenCalledWith(expect.objectContaining({
            userId: ownerId,
            expectedVersion: 3,
            clientMutationId: `buy-again:${orderId}:buy-again-safe-key`,
            commands: [{ type: 'add_item', productId: 44001, quantity: 2 }],
        }));
        expect(recordAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
            event: 'account.order.buy_again',
            meta: { itemCount: 1, duplicate: false },
        }));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        expect(next).not.toHaveBeenCalled();
    });
});
