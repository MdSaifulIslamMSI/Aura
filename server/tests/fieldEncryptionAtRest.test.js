process.env.FIELD_ENCRYPTION_ENABLED = 'true';
process.env.FIELD_ENCRYPTION_MASTER_KEY = 'at-rest-storage-contract-key-material-000'; // nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret -- deterministic test-only key

const fieldEncryptionService = require('../services/fieldEncryptionService');

// Storage-representation contract for encrypted PII fields. DB-free: setters run
// at document construction and toObject({ getters: false }) exposes exactly what
// would be written to MongoDB. Flipping FIELD_ENCRYPTION_ENABLED back to false
// makes these tests fail (values come back plaintext) — the prove-by-revert for
// the rollout flag.
describe('field encryption at rest (storage representation)', () => {
    const User = require('../models/User');
    const Order = require('../models/Order');
    const OtpSession = require('../models/OtpSession');
    const ClientDiagnostic = require('../models/ClientDiagnostic');
    const AssistantThreadMessage = require('../models/AssistantThreadMessage');

    beforeAll(async () => {
        await fieldEncryptionService.primeFieldEncryption();
    });

    test('user address book identity fields are ciphertext, city/state/pincode stay plaintext', () => {
        const user = new User({
            email: 'at-rest@example.com',
            addresses: [{
                name: 'At Rest User',
                phone: '+919999900000',
                address: '42 Confidential Lane',
                city: 'Bengaluru',
                state: 'Karnataka',
                pincode: '560001',
            }],
        });

        const raw = user.toObject({ getters: false });
        expect(raw.addresses[0].name).toMatch(/^v1\./);
        expect(raw.addresses[0].phone).toMatch(/^v1\./);
        expect(raw.addresses[0].address).toMatch(/^v1\./);
        expect(raw.addresses[0].city).toBe('Bengaluru');
        expect(raw.addresses[0].state).toBe('Karnataka');
        expect(raw.addresses[0].pincode).toBe('560001');

        // Hydrated reads decrypt transparently.
        expect(user.addresses[0].name).toBe('At Rest User');
        expect(user.addresses[0].address).toBe('42 Confidential Lane');
    });

    test('user phone is ciphertext with a matching blind index through save() and updates', async () => {
        const user = new User({
            email: 'phone-at-rest@example.com',
            name: 'Phone At Rest',
            phone: '+919876543210',
        });
        await user.validate();

        let raw = user.toObject({ getters: false });
        expect(raw.phone).toMatch(/^v1\./);
        expect(raw.phoneHash).toMatch(/^[0-9a-f]{64}$/);
        expect(user.phone).toBe('+919876543210');
        const savedHash = raw.phoneHash;

        // findOneAndUpdate-style flow: the model hook injects phoneHash into $set
        // at execution time (pre hooks run on exec; the DB is unreachable here,
        // but the mutation happens before the connection attempt).
        const query = User.findOneAndUpdate(
            { email: 'phone-at-rest@example.com' },
            { $set: { phone: '+919999999999' } }
        );
        await query.exec().catch(() => {});
        const update = query.getUpdate();
        expect(update.$set.phoneHash).toMatch(/^[0-9a-f]{64}$/);
        expect(update.$set.phoneHash).not.toBe(savedHash);

        // Flat (non-$set) updates keep working: mongoose normalizes them into
        // $set during exec, and the hook lands phoneHash there.
        const flatQuery = User.updateOne({ email: 'x@example.com' }, { phone: '+918888888888' });
        await flatQuery.exec().catch(() => {});
        const flatUpdate = flatQuery.getUpdate();
        const flatHash = flatUpdate.phoneHash ?? flatUpdate.$set?.phoneHash;
        expect(flatHash).toMatch(/^[0-9a-f]{64}$/);

        // $unset of phone also unsets the index.
        const unsetQuery = User.updateOne({ email: 'x@example.com' }, { $unset: { phone: '' } });
        await unsetQuery.exec().catch(() => {});
        expect(unsetQuery.getUpdate().$unset.phoneHash).toBe('');
    });

    test('email delivery log recipient email is ciphertext with a matching blind index', async () => {
        const EmailDeliveryLog = require('../models/EmailDeliveryLog');
        const entry = new EmailDeliveryLog({
            deliveryId: 'edl_at_rest_1',
            eventType: 'order_confirmation',
            status: 'sent',
            recipientEmail: 'Customer@Example.com',
            recipientMask: 'cu***@example.com',
        });
        await entry.validate();

        const raw = entry.toObject({ getters: false });
        expect(raw.recipientEmail).toMatch(/^v1\./);
        expect(raw.recipientEmailHash).toMatch(/^[0-9a-f]{64}$/);
        expect(entry.recipientEmail).toBe('Customer@Example.com');

        const { computeEmailBlindIndex } = require('../services/blindIndexService');
        expect(raw.recipientEmailHash).toBe(computeEmailBlindIndex('customer@example.com'));
    });

    test('order shipping street line is ciphertext; pricing fields stay plaintext', () => {
        const order = new Order({
            user: '507f1f77bcf86cd799439211',
            orderItems: [{ title: 'x', quantity: 1, image: 'y', price: 1, product: '507f1f77bcf86cd799439212' }],
            shippingAddress: {
                address: '7 Hidden Way',
                city: 'Mumbai',
                postalCode: '400001',
                country: 'India',
            },
            paymentMethod: 'COD',
            totalPrice: 1,
        });

        const raw = order.toObject({ getters: false });
        expect(raw.shippingAddress.address).toMatch(/^v1\./);
        expect(raw.shippingAddress.city).toBe('Mumbai');
        expect(raw.shippingAddress.postalCode).toBe('400001');
        expect(order.shippingAddress.address).toBe('7 Hidden Way');
    });

    test('otp session network metadata is ciphertext; hashes stay plaintext', () => {
        const session = new OtpSession({
            identityKey: '+919999900000',
            user: '507f1f77bcf86cd799439211',
            purpose: 'login',
            otpHash: 'hmac-sha256:abcdef',
            expiresAt: new Date(Date.now() + 60000),
            requestMeta: {
                ip: '203.0.113.7',
                userAgent: 'Mozilla/5.0 AtRestTest',
                location: 'Bengaluru, IN',
                deviceSessionHash: 'hashhashhash',
                credentialUid: 'uid-123',
            },
        });

        const raw = session.toObject({ getters: false });
        expect(raw.requestMeta.ip).toMatch(/^v1\./);
        expect(raw.requestMeta.userAgent).toMatch(/^v1\./);
        expect(raw.requestMeta.location).toMatch(/^v1\./);
        expect(raw.requestMeta.deviceSessionHash).toBe('hashhashhash');
        expect(raw.requestMeta.credentialUid).toBe('uid-123');
        expect(session.requestMeta.ip).toBe('203.0.113.7');
    });

    test('client diagnostic network metadata is ciphertext', () => {
        const diagnostic = new ClientDiagnostic({
            type: 'error',
            clientIp: '198.51.100.9',
            userAgent: 'Mozilla/5.0 DiagnosticTest',
        });

        const raw = diagnostic.toObject({ getters: false });
        expect(raw.clientIp).toMatch(/^v1\./);
        expect(raw.userAgent).toMatch(/^v1\./);
        expect(diagnostic.clientIp).toBe('198.51.100.9');
    });

    test('assistant message content is ciphertext', () => {
        const message = new AssistantThreadMessage({
            thread: '507f1f77bcf86cd799439211',
            user: '507f1f77bcf86cd799439211',
            sessionId: 'session-at-rest',
            role: 'user',
            content: 'where is my order with the gift inside',
        });

        const raw = message.toObject({ getters: false });
        expect(raw.content).toMatch(/^v1\./);
        expect(message.content).toBe('where is my order with the gift inside');
    });

    test('decryptValue() recovers ciphertext for .lean() consumers', () => {
        const { decryptValue } = require('../models/utils/encryptedField');
        const diagnostic = new ClientDiagnostic({ type: 'error', clientIp: '198.51.100.10' });
        const raw = diagnostic.toObject({ getters: false });

        expect(decryptValue(raw.clientIp)).toBe('198.51.100.10');
        expect(decryptValue('legacy plaintext value')).toBe('legacy plaintext value');
        expect(decryptValue('')).toBe('');
    });
});
