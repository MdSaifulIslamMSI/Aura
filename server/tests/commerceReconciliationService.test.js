jest.mock('../models/Order', () => ({
  find: jest.fn(), countDocuments: jest.fn(),
}));
jest.mock('../models/User', () => ({ findById: jest.fn() }));
jest.mock('../models/PaymentIntent', () => ({ find: jest.fn() }));
jest.mock('../models/PaymentOutboxTask', () => ({ countDocuments: jest.fn() }));
jest.mock('../models/OrderEmailNotification', () => ({ countDocuments: jest.fn() }));
jest.mock('../models/AdminNotification', () => ({ create: jest.fn() }));
jest.mock('../services/payments/outboxState', () => ({ scheduleCaptureTask: jest.fn(), scheduleRefundTask: jest.fn() }));
jest.mock('../services/email/orderEmailQueueService', () => ({ enqueueOrderPlacedEmail: jest.fn() }));

const Order = require('../models/Order');
const PaymentOutboxTask = require('../models/PaymentOutboxTask');
const OrderEmailNotification = require('../models/OrderEmailNotification');
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
});
