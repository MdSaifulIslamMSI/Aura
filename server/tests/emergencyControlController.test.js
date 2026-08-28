jest.mock('../services/emergencyControlService', () => ({
    activateFlag: jest.fn(),
    buildPublicStatus: jest.fn(),
    deactivateFlag: jest.fn(),
    extendFlag: jest.fn(),
    getAllActiveFlags: jest.fn(),
    getAllFlagsForAdmin: jest.fn(),
    recordFailedAttempt: jest.fn(),
    updateFlagMessage: jest.fn(),
}));

const {
    activateFlag,
    buildPublicStatus,
    deactivateFlag,
    extendFlag,
    getAllActiveFlags,
    getAllFlagsForAdmin,
    recordFailedAttempt,
    updateFlagMessage,
} = require('../services/emergencyControlService');
const {
    activateEmergencyControl,
    deactivateEmergencyControl,
    extendEmergencyControl,
    getEmergencyStatus,
    listEmergencyAuditLogs,
    listEmergencyControls,
    stripInternalFlagFields,
    updateEmergencyControlMessage,
} = require('../controllers/emergencyControlController');
const EmergencyAuditLog = require('../models/EmergencyAuditLog');

jest.mock('../models/EmergencyAuditLog', () => ({
    find: jest.fn(),
}));

let auditLogStub = [];

const createRes = () => {
    const res = {
        headers: {},
        statusCode: 200,
        body: undefined,
        set(key, value) {
            this.headers[key] = value;
            return this;
        },
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
    auditLogStub = [];
    EmergencyAuditLog.find.mockImplementation(() => ({
        sort: () => ({
            limit: () => ({
                lean: async () => auditLogStub,
            }),
        }),
    }));
});
describe('emergencyControlController', () => {
    describe('stripInternalFlagFields', () => {
        test('removes internal operator fields and keeps public ones', () => {
            const safe = stripInternalFlagFields({
                key: 'GLOBAL_MAINTENANCE',
                enabled: true,
                severity: 'critical',
                internalReason: 'incident-1234',
                activatedByEmail: 'ops@aura.dev',
                userMessage: 'Down for maintenance',
            });
            expect(safe).toEqual({
                key: 'GLOBAL_MAINTENANCE',
                enabled: true,
                severity: 'critical',
                userMessage: 'Down for maintenance',
            });
        });

        test('tolerates null input', () => {
            expect(stripInternalFlagFields(null)).toEqual({});
        });
    });

    describe('critical control guard', () => {
        test('rejects activation of a critical flag without a reason', async () => {
            const { res, next } = await invoke(activateEmergencyControl, {
                params: { key: 'GLOBAL_MAINTENANCE' },
                body: {},
                requestId: 'req-1',
            });

            expect(res.body).toBeUndefined();
            expect(next).toHaveBeenCalledTimes(1);
            const error = next.mock.calls[0][0];
            expect(error.statusCode).toBe(400);
            expect(error.message).toBe('Critical emergency actions require a reason');
            expect(recordFailedAttempt).toHaveBeenCalledWith(expect.objectContaining({
                flagKey: 'GLOBAL_MAINTENANCE',
                reason: 'critical_reason_required',
                metadata: { action: 'ACTIVATE' },
            }));
            expect(activateFlag).not.toHaveBeenCalled();
        });

        test('rejects critical deactivation without the confirmation phrase', async () => {
            const { next } = await invoke(deactivateEmergencyControl, {
                params: { key: 'READ_ONLY_MODE' },
                body: { reason: 'staging drill', confirmationPhrase: 'yes I do' },
            });

            const error = next.mock.calls[0][0];
            expect(error.statusCode).toBe(400);
            expect(error.message).toBe('Type I UNDERSTAND to confirm this critical emergency action');
            expect(recordFailedAttempt).toHaveBeenCalledWith(expect.objectContaining({
                flagKey: 'READ_ONLY_MODE',
                reason: 'critical_confirmation_phrase_required',
                metadata: { action: 'DEACTIVATE' },
            }));
            expect(deactivateFlag).not.toHaveBeenCalled();
        });
        test('activates a critical flag when reason and confirmation phrase are present', async () => {
            const flag = { key: 'GLOBAL_MAINTENANCE', enabled: true };
            activateFlag.mockResolvedValue(flag);

            const { res, next } = await invoke(activateEmergencyControl, {
                params: { key: 'GLOBAL_MAINTENANCE' },
                body: { reason: 'db failover', confirmationPhrase: 'I UNDERSTAND' },
                requestId: 'req-2',
            });

            expect(next).not.toHaveBeenCalled();
            expect(recordFailedAttempt).not.toHaveBeenCalled();
            expect(activateFlag).toHaveBeenCalledWith('GLOBAL_MAINTENANCE', expect.objectContaining({
                reason: 'db failover',
            }));
            expect(res.statusCode).toBe(200);
            expect(res.body).toMatchObject({ success: true, flag, requestId: 'req-2' });
        });

        test('does not require reason or phrase for non-critical flags', async () => {
            activateFlag.mockResolvedValue({ key: 'DISABLE_SIGNUP', enabled: true });

            await invoke(activateEmergencyControl, {
                params: { key: 'DISABLE_SIGNUP' },
                body: {},
            });

            expect(recordFailedAttempt).not.toHaveBeenCalled();
            expect(activateFlag).toHaveBeenCalledWith('DISABLE_SIGNUP', expect.objectContaining({ req: expect.anything() }));
        });
    });

    describe('read and update endpoints', () => {
        test('getEmergencyStatus returns the public status with no-store', async () => {
            buildPublicStatus.mockResolvedValue({ activeFlags: [] });
            const { res } = await invoke(getEmergencyStatus, {});

            expect(res.headers['Cache-Control']).toBe('no-store');
            expect(res.body).toEqual({ activeFlags: [] });
        });

        test('listEmergencyControls returns flags, active flags, and request id', async () => {
            getAllFlagsForAdmin.mockResolvedValue([{ key: 'A' }]);
            getAllActiveFlags.mockResolvedValue([{ key: 'A', enabled: true }]);
            const { res } = await invoke(listEmergencyControls, { requestId: 'req-3' });

            expect(getAllActiveFlags).toHaveBeenCalledWith({ failOpen: true });
            expect(res.body).toMatchObject({
                success: true,
                flags: [{ key: 'A' }],
                activeFlags: [{ key: 'A', enabled: true }],
                requestId: 'req-3',
            });
        });

        test('listEmergencyAuditLogs returns stored logs with no-store', async () => {
            auditLogStub = [{ flagKey: 'DISABLE_PAYMENT' }];
            const { res } = await invoke(listEmergencyAuditLogs, {
                query: { flagKey: 'DISABLE_PAYMENT', limit: '500' },
            });

            expect(res.body.success).toBe(true);
            expect(res.body.logs).toHaveLength(1);
            expect(res.headers['Cache-Control']).toBe('no-store');
        });

        test('extend and message-update handlers forward their inputs', async () => {
            extendFlag.mockResolvedValue({ key: 'DISABLE_PAYMENT' });
            updateFlagMessage.mockResolvedValue({ key: 'DISABLE_PAYMENT', userMessage: 'x' });

            const extended = await invoke(extendEmergencyControl, {
                params: { key: 'DISABLE_PAYMENT' },
                body: { reason: 'still down', expiresAt: '2026-12-31T00:00:00.000Z' },
            });
            expect(extendFlag).toHaveBeenCalledWith('DISABLE_PAYMENT', expect.objectContaining({
                reason: 'still down',
            }));
            expect(extended.res.body.success).toBe(true);

            const updated = await invoke(updateEmergencyControlMessage, {
                params: { key: 'DISABLE_PAYMENT' },
                body: { userMessage: 'x', reason: 'clearer copy' },
            });
            expect(updateFlagMessage).toHaveBeenCalledWith('DISABLE_PAYMENT', expect.objectContaining({
                userMessage: 'x',
                reason: 'clearer copy',
            }));
            expect(updated.res.body.success).toBe(true);
        });
    });
});