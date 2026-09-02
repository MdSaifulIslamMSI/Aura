jest.mock('../services/cartService', () => ({
    parseExpectedVersion: jest.fn(),
    getCartSnapshot: jest.fn(),
    applyCartCommands: jest.fn(),
}));

jest.mock('../services/cartRealtimeService', () => ({
    emitCartRealtimeUpdate: jest.fn(),
}));

const { parseExpectedVersion, getCartSnapshot, applyCartCommands } = require('../services/cartService');
const { emitCartRealtimeUpdate } = require('../services/cartRealtimeService');
const { getCanonicalCart, applyCanonicalCartCommands } = require('../controllers/cartController');

const createRes = () => {
    const res = {
        statusCode: 200,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
    return res;
};

const invoke = async (handler, req) => {
    const res = createRes();
    const next = jest.fn();
    await handler(req, res, next);
    return { res, next };
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe('cartController.getCanonicalCart', () => {
    test('rejects unauthenticated requests with 401', async () => {
        const { res, next } = await invoke(getCanonicalCart, {});

        expect(res.body).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0].statusCode).toBe(401);
        expect(getCartSnapshot).not.toHaveBeenCalled();
    });

    test('returns the cart snapshot with the caller context', async () => {
        const user = { _id: 'u1' };
        const market = { code: 'IN' };
        const cart = { items: [], version: 7 };
        getCartSnapshot.mockResolvedValue(cart);

        const { res, next } = await invoke(getCanonicalCart, { user, market });

        expect(next).not.toHaveBeenCalled();
        expect(getCartSnapshot).toHaveBeenCalledWith({ userId: 'u1', user, market });
        expect(res.body).toBe(cart);
    });
});

describe('cartController.applyCanonicalCartCommands', () => {
    const baseReq = (overrides = {}) => ({
        user: { _id: 'u1', authUid: 'auth-1' },
        authUid: 'auth-1',
        body: { commands: [{ op: 'add' }], expectedVersion: 7, clientMutationId: 'cm-1' },
        market: { code: 'IN' },
        requestId: 'req-1',
        ...overrides,
    });

    test('rejects unauthenticated requests with 401', async () => {
        const { next } = await invoke(applyCanonicalCartCommands, { body: { commands: [{}] } });

        expect(next.mock.calls[0][0].statusCode).toBe(401);
        expect(applyCartCommands).not.toHaveBeenCalled();
    });

    test('rejects non-array and empty command lists with 400', async () => {
        const missing = await invoke(applyCanonicalCartCommands, baseReq({ body: {} }));
        expect(missing.next.mock.calls[0][0].statusCode).toBe(400);

        const empty = await invoke(applyCanonicalCartCommands, baseReq({ body: { commands: [] } }));
        expect(empty.next.mock.calls[0][0].statusCode).toBe(400);

        const notArray = await invoke(applyCanonicalCartCommands, baseReq({ body: { commands: 'nope' } }));
        expect(notArray.next.mock.calls[0][0].statusCode).toBe(400);

        const error = empty.next.mock.calls[0][0];
        expect(error.message).toBe('commands must be a non-empty array');
    });

    test('responds 409 with the current cart on a version conflict', async () => {
        const cart = { items: [], version: 9 };
        applyCartCommands.mockResolvedValue({ conflict: true, cart });

        const { res, next } = await invoke(applyCanonicalCartCommands, baseReq());

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(409);
        expect(res.body).toMatchObject({
            code: 'cart_version_conflict',
            message: 'Cart version conflict',
        });
        expect(res.body.cart).toBe(cart);
        expect(emitCartRealtimeUpdate).not.toHaveBeenCalled();
    });

    test('applies commands, emits realtime updates, and reports the applied mutation id', async () => {
        parseExpectedVersion.mockReturnValue(7);
        const cart = { items: [{ productId: 1, quantity: 2 }], version: 8 };
        applyCartCommands.mockResolvedValue({ conflict: false, cart, appliedMutationId: 'server-1' });

        const { res } = await invoke(applyCanonicalCartCommands, baseReq());

        expect(applyCartCommands).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'u1',
            user: { _id: 'u1', authUid: 'auth-1' },
            expectedVersion: 7,
            clientMutationId: 'cm-1',
            commands: [{ op: 'add' }],
            market: { code: 'IN' },
        }));
        expect(parseExpectedVersion).toHaveBeenCalledWith(7);
        expect(emitCartRealtimeUpdate).toHaveBeenCalledWith(expect.objectContaining({
            socketUserId: 'u1',
            authUid: 'auth-1',
            cart,
            reason: 'cart_commands_applied',
            requestId: 'req-1',
            source: 'cart_controller',
        }));
        expect(res.body).toEqual({ cart, appliedMutationId: 'server-1' });
    });

    test('falls back to the client mutation id when the service does not assign one', async () => {
        applyCartCommands.mockResolvedValue({ conflict: false, cart: { items: [], version: 8 } });

        const { res } = await invoke(applyCanonicalCartCommands, baseReq());

        expect(res.body.appliedMutationId).toBe('cm-1');
    });
});