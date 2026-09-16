const fs = require('node:fs');
const path = require('node:path');

// OS-keychain-backed storage for the desktop renderer (Electron safeStorage:
// DPAPI on Windows, Keychain on macOS, libsecret on Linux). Values are never
// written to disk in plaintext; if the OS provider is unavailable the module
// reports unavailable and the caller stays memory-only.
//
// Extracted as a pure module so it is testable without Electron.

const STORAGE_FILE = 'secure-storage.json';
const MAX_VALUE_BYTES = 16 * 1024;
const MAX_ENTRIES = 64;

const sanitizeKey = (key = '') => String(key || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '')
    .slice(0, 120);

const createDesktopSecureStorage = ({
    resolveStorageDir,
    safeStorage,
    fsModule = fs,
    pathModule = path,
} = {}) => {
    const resolveFile = () => pathModule.join(resolveStorageDir(), STORAGE_FILE);

    const readStore = () => {
        try {
            const parsed = JSON.parse(fsModule.readFileSync(resolveFile(), 'utf8'));
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    };

    const writeStore = (store) => {
        const file = resolveFile();
        fsModule.mkdirSync(pathModule.dirname(file), { recursive: true });
        fsModule.writeFileSync(file, JSON.stringify(store), { encoding: 'utf8', mode: 0o600 });
    };

    const isAvailable = () => Boolean(safeStorage?.isEncryptionAvailable?.());

    const read = (key) => {
        const sanitized = sanitizeKey(key);
        if (!sanitized || !isAvailable()) return '';
        const store = readStore();
        const wrapped = store[sanitized];
        if (typeof wrapped !== 'string' || !wrapped) return '';
        try {
            return safeStorage.decryptString(Buffer.from(wrapped, 'base64'));
        } catch {
            return '';
        }
    };

    const write = (key, value = '') => {
        const sanitized = sanitizeKey(key);
        if (!sanitized || !isAvailable()) return false;

        const store = readStore();
        if (value === '') {
            delete store[sanitized];
            writeStore(store);
            return true;
        }

        const raw = Buffer.from(String(value), 'utf8');
        if (raw.length > MAX_VALUE_BYTES) return false;

        const encrypted = safeStorage.encryptString(String(value));
        const nextEntries = { ...store, [sanitized]: encrypted.toString('base64') };
        // Evict oldest entries (JSON key order is insertion order) to bound file size.
        const keys = Object.keys(nextEntries);
        if (keys.length > MAX_ENTRIES) {
            keys.slice(0, keys.length - MAX_ENTRIES).forEach((stale) => delete nextEntries[stale]);
        }
        writeStore(nextEntries);
        return true;
    };

    return { read, write, isAvailable };
};

module.exports = { createDesktopSecureStorage, sanitizeKey, STORAGE_FILE };
