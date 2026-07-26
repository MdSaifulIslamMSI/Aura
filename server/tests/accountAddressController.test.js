jest.mock('../models/User');
jest.mock('../services/authProfileVault');
jest.mock('../middleware/authMiddleware');
jest.mock('../services/authSecurityTelemetryService');

const User = require('../models/User');
const { recordAuthSecurityEvent } = require('../services/authSecurityTelemetryService');
const {
    addAddress,
    updateAddress,
    deleteAddress,
} = require('../controllers/userController');

const baseAddress = {
    _id: '507f1f77bcf86cd799439011',
    type: 'home',
    name: 'Address User',
    phone: '919876543210',
    address: '12 Market Road',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411001',
    isDefault: true,
};

const buildUser = (addresses = []) => ({
    _id: '507f1f77bcf86cd799439099',
    email: 'address-owner@example.com',
    name: 'Address Owner',
    addresses,
    __v: 2,
    save: jest.fn().mockResolvedValue(undefined),
});

const buildRequest = (body = {}, params = {}) => ({
    body,
    params,
    authUid: 'address-owner-auth-uid',
    user: {
        _id: '507f1f77bcf86cd799439099',
        email: 'address-owner@example.com',
    },
});

const buildResponse = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
});

describe('account address controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('normalizes an address, assigns the first default, and emits a value-free audit event', async () => {
        const user = buildUser([]);
        User.findOne.mockResolvedValue(user);
        const req = buildRequest({
            ...baseAddress,
            _id: undefined,
            name: '  Address User  ',
            address: '  12   Market Road ',
            phone: '+91 9876543210',
            isDefault: false,
        });
        const res = buildResponse();
        const next = jest.fn();

        await addAddress(req, res, next);

        expect(user.addresses).toEqual([
            expect.objectContaining({
                name: 'Address User',
                phone: '919876543210',
                address: '12 Market Road',
                isDefault: true,
            }),
        ]);
        expect(recordAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
            event: 'account.address.added',
            meta: { defaultShipping: true },
        }));
        expect(res.status).toHaveBeenCalledWith(201);
        expect(next).not.toHaveBeenCalled();
    });

    test('rejects a normalized duplicate without writing', async () => {
        const addresses = [{ ...baseAddress }];
        const user = buildUser(addresses);
        User.findOne.mockResolvedValue(user);
        const req = buildRequest({
            ...baseAddress,
            _id: undefined,
            address: ' 12   MARKET road ',
            city: 'pune',
            state: 'maharashtra',
        });
        const res = buildResponse();
        const next = jest.fn();

        await addAddress(req, res, next);

        expect(user.save).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 409,
            code: 'ACCOUNT_ADDRESS_DUPLICATE',
        }));
    });

    test('does not allow an address identifier outside the authenticated owner document', async () => {
        const addresses = [];
        addresses.id = jest.fn().mockReturnValue(null);
        User.findOne.mockResolvedValue(buildUser(addresses));
        const req = buildRequest(baseAddress, {
            addressId: '507f1f77bcf86cd799439012',
        });
        const res = buildResponse();
        const next = jest.fn();

        await updateAddress(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 404,
        }));
        expect(recordAuthSecurityEvent).not.toHaveBeenCalled();
    });

    test('deleting a default address reassigns the default and records no address values', async () => {
        const removedAddress = { ...baseAddress };
        const remainingAddress = {
            ...baseAddress,
            _id: '507f1f77bcf86cd799439013',
            address: '45 Lake Road',
            isDefault: false,
        };
        const addresses = [removedAddress, remainingAddress];
        addresses.id = jest.fn().mockReturnValue(removedAddress);
        addresses.pull = jest.fn(() => {
            addresses.splice(0, 1);
        });
        const user = buildUser(addresses);
        User.findOne.mockResolvedValue(user);
        const req = buildRequest({}, {
            addressId: removedAddress._id,
        });
        const res = buildResponse();
        const next = jest.fn();

        await deleteAddress(req, res, next);

        expect(remainingAddress.isDefault).toBe(true);
        expect(recordAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
            event: 'account.address.deleted',
            meta: { reassignedDefaultShipping: true },
        }));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            historicalOrderAddressesUnaffected: true,
        }));
        expect(next).not.toHaveBeenCalled();
    });
});
