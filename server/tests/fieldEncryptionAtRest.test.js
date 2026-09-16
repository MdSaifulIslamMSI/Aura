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
