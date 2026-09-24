jest.mock('../models/Order', () => ({
  find: jest.fn(), countDocuments: jest.fn(), updateOne: jest.fn(),
}));
jest.mock('../models/User', () => ({ findById: jest.fn() }));
jest.mock('../models/PaymentIntent', () => ({ find: jest.fn() }));
jest.mock('../models/PaymentOutboxTask', () => ({ countDocuments: jest.fn(), findOne: jest.fn() }));
jest.mock('../models/OrderEmailNotification', () => ({ find: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../models/AdminNotification', () => ({ create: jest.fn() }));
jest.mock('../services/payments/outboxState', () => ({ scheduleCaptureTask: jest.fn(), scheduleRefundTask: jest.fn() }));
jest.mock('../services/email/orderEmailQueueService', () => ({ enqueueOrderPlacedEmail: jest.fn() }));

const Order = require('../models/Order');
const PaymentIntent = require('../models/PaymentIntent');
const PaymentOutboxTask = require('../models/PaymentOutboxTask');
const OrderEmailNotification = require('../models/OrderEmailNotification');
const { scheduleRefundTask } = require('../services/payments/outboxState');
const {
  getCommerceReconciliationStatus,
  runCommerceReconciliationCycle,
  startCommerceReconciliationWorker,
  stopCommerceReconciliationWorkerForTests,
} = require('../services/commerceReconciliationService');

describe('commerceReconciliationService status', () => {
  beforeEach(() => jest.clearAllMocks());

  test('aggregates backlog counters across queues', async () => {
    PaymentOutboxTask.countDocuments.mockResolvedValue(2);
    OrderEmailNotification.countDocuments.mockResolvedValue(1);
    Order.countDocuments.mockResolvedValue(0);

    const status = await getCommerceReconciliationStatus();
    expect(PaymentOutboxTask.countDocuments).toHaveBeenCalledTimes(3);
    expect(status).toMatchObject({
      paymentCaptureBacklog: 2,
      refundBacklog: 2,
      orderEmailBacklog: 1,
    });
  });
});

describe('commerceReconciliationService worker lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stopCommerceReconciliationWorkerForTests();
    jest.useFakeTimers();
  });

  afterEach(() => {
    stopCommerceReconciliationWorkerForTests();
    jest.useRealTimers();
  });

  test('starts the worker once and stops it cleanly', () => {
    Order.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    startCommerceReconciliationWorker();
    startCommerceReconciliationWorker();
    expect(jest.getTimerCount()).toBe(1);
    stopCommerceReconciliationWorkerForTests();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('commerceReconciliationService cycle', () => {
  beforeEach(() => jest.clearAllMocks());

  test('settles quietly with no candidate orders', async () => {
    Order.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    const summary = await runCommerceReconciliationCycle();
    expect(summary).toMatchObject({ status: 'healthy', scannedOrders: 0 });
    expect(Order.find).toHaveBeenCalled();
  });

  test('does not mark a cancelled order paid when reconciliation sees a captured intent', async () => {
    const order = {
      _id: 'order-cancelled-after-capture',
      paymentIntentId: 'pi-cancelled-after-capture',
      orderStatus: 'cancelled',
      cancelledAt: new Date(),
      paymentState: 'authorized',
      paymentCapturedAt: null,
      isPaid: false,
      paidAt: null,
      confirmationEmailStatus: 'skipped',
      refundSummary: { fullyRefunded: false },
      commandCenter: { refunds: [] },
    };
    const intent = {
      intentId: order.paymentIntentId,
      order: order._id,
      amount: 1999,
      status: 'captured',
      capturedAt: new Date(),
    };
    Order.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([order]),
    });
    PaymentIntent.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([intent]) });
    OrderEmailNotification.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    Order.updateOne.mockResolvedValue({});
    scheduleRefundTask.mockResolvedValue({});

    await runCommerceReconciliationCycle();

    expect(Order.updateOne).toHaveBeenCalledWith(
      { _id: order._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          isPaid: false,
          paidAt: null,
          paymentState: 'captured',
        }),
      })
    );
    expect(scheduleRefundTask).toHaveBeenCalledWith(expect.objectContaining({
      intentId: intent.intentId,
      orderId: order._id,
      amount: intent.amount,
      amountMode: 'charge',
      reason: 'order_cancelled_after_capture',
    }));
  });

  test('does not regress a refunded order when a stale captured intent is seen', async () => {
    const order = {
      _id: 'order-refunded-reconcile',
      paymentIntentId: 'pi-refunded-reconcile',
      orderStatus: 'delivered',
      paymentState: 'refunded',
      paymentCapturedAt: new Date(),
      isPaid: true,
      paidAt: new Date(),
      confirmationEmailStatus: 'skipped',
      refundSummary: { fullyRefunded: true },
      commandCenter: { refunds: [] },
    };
    const intent = {
      intentId: order.paymentIntentId,
      order: order._id,
      amount: 1999,
      status: 'captured',
      capturedAt: new Date(),
    };
    Order.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([order]),
    });
    PaymentIntent.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([intent]) });
    OrderEmailNotification.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    Order.updateOne.mockResolvedValue({});
    scheduleRefundTask.mockResolvedValue({});

    await runCommerceReconciliationCycle();

    expect(Order.updateOne).not.toHaveBeenCalledWith(
      { _id: order._id },
      expect.objectContaining({
        $set: expect.objectContaining({ paymentState: 'captured' }),
      })
    );
  });
});
