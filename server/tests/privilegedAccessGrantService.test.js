jest.mock('../models/PrivilegedAccessGrant', () => ({
    create: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    updateMany: jest.fn(),
}));

const PrivilegedAccessGrant = require('../models/PrivilegedAccessGrant');
const {
    requestGrant,
    approveGrant,
    denyGrant,
    revokeGrant,
    getActiveGrantsForUser,
    assertPermissionEligible,
} = require('../services/auth/privilegedAccessGrantService');
const AppError = require('../utils/AppError');

const makeChain = (result) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
});

const SUBJECT = '64c0b0ff0f1e2c3d4e5f6a7d';
const APPROVER = '64c0b0ff0f1e2c3d4e5f6a7e';

describe('privilegedAccessGrantService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        PrivilegedAccessGrant.updateMany.mockResolvedValue({ modifiedCount: 0 });
    });

    describe('assertPermissionEligible', () => {
        test('accepts permissions in approvalRequiredFor', () => {
            expect(assertPermissionEligible('admin.users.delete')).toBe('admin.users.delete');
        });

        test('rejects permissions outside the manifest', () => {
            expect(() => assertPermissionEligible('admin.products.write')).toThrow(AppError);
            try {
                assertPermissionEligible('admin.products.write');
            } catch (error) {
                expect(error.statusCode).toBe(400);
                expect(error.code).toBe('PRIVILEGED_PERMISSION_NOT_ELIGIBLE');
            }
        });
    });

    describe('requestGrant', () => {
        test('creates a pending grant for an eligible permission', async () => {
            PrivilegedAccessGrant.findOne.mockReturnValue(makeChain(null));
            PrivilegedAccessGrant.create.mockResolvedValue({
                grantId: 'jit_1',
                subjectUser: SUBJECT,
                permission: 'admin.users.delete',
                status: 'pending',
                reason: 'Offboarding a fraudulent seller account',
            });

            const grant = await requestGrant({
                subjectUser: SUBJECT,
                permission: 'admin.users.delete',
                reason: 'Offboarding a fraudulent seller account',
            });

            expect(grant.status).toBe('pending');
            expect(PrivilegedAccessGrant.create).toHaveBeenCalledWith(expect.objectContaining({
                subjectUser: SUBJECT,
                permission: 'admin.users.delete',
                status: 'pending',
            }));
        });

        test('rejects a duplicate pending or active grant', async () => {
            PrivilegedAccessGrant.findOne.mockReturnValue(makeChain({ grantId: 'jit_existing' }));

            await expect(requestGrant({
                subjectUser: SUBJECT,
                permission: 'admin.users.delete',
                reason: 'Offboarding a fraudulent seller account',
            })).rejects.toMatchObject({ code: 'PRIVILEGED_GRANT_ALREADY_ACTIVE', statusCode: 409 });
        });

        test('rejects ineligible permissions before touching the store', async () => {
            await expect(requestGrant({
                subjectUser: SUBJECT,
                permission: 'admin.products.write',
                reason: 'Not eligible for JIT gating',
            })).rejects.toMatchObject({ code: 'PRIVILEGED_PERMISSION_NOT_ELIGIBLE' });
            expect(PrivilegedAccessGrant.findOne).not.toHaveBeenCalled();
        });
    });

    describe('approveGrant', () => {
        test('approves a pending grant with a TTL expiry from config', async () => {
            const save = jest.fn().mockResolvedValue(undefined);
            PrivilegedAccessGrant.findOne.mockResolvedValue({
                grantId: 'jit_1',
                subjectUser: SUBJECT,
                permission: 'admin.users.delete',
                status: 'pending',
                requestedBy: SUBJECT,
                save,
            });

            const grant = await approveGrant({ grantId: 'jit_1', approverUser: { _id: APPROVER } });

            expect(grant.status).toBe('approved');
            expect(grant.approvedBy).toEqual(APPROVER);
            expect(grant.expiresAt.getTime()).toBeGreaterThan(Date.now());
            expect(save).toHaveBeenCalled();
        });

        test('rejects self-approval', async () => {
            PrivilegedAccessGrant.findOne.mockResolvedValue({
                grantId: 'jit_1',
                subjectUser: SUBJECT,
                status: 'pending',
                requestedBy: SUBJECT,
            });

            await expect(approveGrant({ grantId: 'jit_1', approverUser: { _id: SUBJECT } }))
                .rejects.toMatchObject({ code: 'PRIVILEGED_SELF_APPROVAL_DENIED', statusCode: 403 });
        });

        test('rejects non-pending grants', async () => {
            PrivilegedAccessGrant.findOne.mockResolvedValue({
                grantId: 'jit_1',
                status: 'approved',
                requestedBy: SUBJECT,
            });

            await expect(approveGrant({ grantId: 'jit_1', approverUser: { _id: APPROVER } }))
                .rejects.toMatchObject({ code: 'PRIVILEGED_GRANT_NOT_PENDING', statusCode: 409 });
        });
    });

    describe('denyGrant', () => {
        test('denies a pending grant with a reason', async () => {
            const save = jest.fn().mockResolvedValue(undefined);
            PrivilegedAccessGrant.findOne.mockResolvedValue({
                grantId: 'jit_1',
                status: 'pending',
                requestedBy: SUBJECT,
                save,
            });

            const grant = await denyGrant({
                grantId: 'jit_1',
                approverUser: { _id: APPROVER },
                reason: 'Insufficient justification',
            });

            expect(grant.status).toBe('denied');
            expect(grant.deniedReason).toBe('Insufficient justification');
        });
    });

    describe('revokeGrant', () => {
        test('revokes an approved grant immediately', async () => {
            const save = jest.fn().mockResolvedValue(undefined);
            PrivilegedAccessGrant.findOne.mockResolvedValue({
                grantId: 'jit_1',
                status: 'approved',
                requestedBy: SUBJECT,
                save,
            });

            const grant = await revokeGrant({ grantId: 'jit_1', approverUser: { _id: APPROVER } });

            expect(grant.status).toBe('revoked');
        });

        test('rejects revoking a non-approved grant', async () => {
            PrivilegedAccessGrant.findOne.mockResolvedValue({
                grantId: 'jit_1',
                status: 'pending',
                requestedBy: SUBJECT,
            });

            await expect(revokeGrant({ grantId: 'jit_1', approverUser: { _id: APPROVER } }))
                .rejects.toMatchObject({ code: 'PRIVILEGED_GRANT_NOT_ACTIVE', statusCode: 409 });
        });
    });

    describe('getActiveGrantsForUser', () => {
        test('returns approved, unexpired grants in evaluation shape', async () => {
            PrivilegedAccessGrant.find.mockReturnValue(makeChain([
                { grantId: 'jit_1', permission: 'admin.users.delete', status: 'approved', expiresAt: new Date(Date.now() + 60000) },
            ]));

            const grants = await getActiveGrantsForUser(SUBJECT);

            expect(grants).toHaveLength(1);
            expect(grants[0]).toMatchObject({ grantId: 'jit_1', permission: 'admin.users.delete', status: 'approved' });
        });

        test('returns empty for a missing subject', async () => {
            expect(await getActiveGrantsForUser(null)).toEqual([]);
            expect(PrivilegedAccessGrant.find).not.toHaveBeenCalled();
        });
    });
});
