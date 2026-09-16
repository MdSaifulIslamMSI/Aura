const assert = require('node:assert/strict');
const test = require('node:test');
const { createDesktopSecureStorage } = require('./secureStorage.cjs');

const makeFakeSafeStorage = ({ available = true } = {}) => ({
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`enc:${Buffer.from(value, 'utf8').toString('base64')}`),
    decryptString: (buffer) => {
        const text = buffer.toString('utf8');
        if (!text.startsWith('enc:')) throw new Error('tampered');
        return Buffer.from(text.slice(4), 'base64').toString('utf8');
    },
});

const makeFakeFs = () => {
    const files = new Map();
    return {
        files,
        mkdirSync: () => {},
        readFileSync: (file) => {
            if (!files.has(file)) throw new Error('ENOENT');
            return files.get(file);
        },
        writeFileSync: (file, contents) => {
            files.set(file, contents);
        },
    };
};

test('secure storage round-trips values through the OS encryption provider', () => {
    const fsModule = makeFakeFs();
    const storage = createDesktopSecureStorage({
        resolveStorageDir: () => '/userdata',
        safeStorage: makeFakeSafeStorage(),
        fsModule,
    });

    assert.equal(storage.isAvailable(), true);
    assert.equal(storage.write('trusted-device-session', 'secret-token-value'), true);

    const onDisk = [...fsModule.files.values()][0];
    assert.ok(!onDisk.includes('secret-token-value'), 'plaintext must never reach disk');

    assert.equal(storage.read('trusted-device-session'), 'secret-token-value');
});

test('secure storage reports unavailable and never stores when the OS provider is missing', () => {
    const fsModule = makeFakeFs();
    const storage = createDesktopSecureStorage({
        resolveStorageDir: () => '/userdata',
        safeStorage: makeFakeSafeStorage({ available: false }),
        fsModule,
    });

    assert.equal(storage.write('key', 'value'), false);
    assert.equal(storage.read('key'), '');
    assert.equal(fsModule.files.size, 0);
});

test('secure storage clears entries with an empty value and rejects oversized values', () => {
    const fsModule = makeFakeFs();
    const storage = createDesktopSecureStorage({
        resolveStorageDir: () => '/userdata',
        safeStorage: makeFakeSafeStorage(),
        fsModule,
    });

    storage.write('key-a', 'value-a');
    assert.equal(storage.write('key-a', ''), true);
    assert.equal(storage.read('key-a'), '');

    assert.equal(storage.write('key-big', 'x'.repeat(17 * 1024)), false);
});

test('secure storage tolerates corrupted or tampered files on read', () => {
    const fsModule = makeFakeFs();
    const storage = createDesktopSecureStorage({
        resolveStorageDir: () => '/userdata',
        safeStorage: makeFakeSafeStorage(),
        fsModule,
    });

    storage.write('key', 'value');
    const file = [...fsModule.files.keys()][0];
    fsModule.files.set(file, '{not json');

    assert.equal(storage.read('key'), '');

    // A value that fails decryption reads as empty instead of throwing.
    const store = { key: Buffer.from('garbage').toString('base64') };
    fsModule.files.set(file, JSON.stringify(store));
    assert.equal(storage.read('key'), '');
});
