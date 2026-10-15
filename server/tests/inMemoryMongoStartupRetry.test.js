const {
    isBinaryLockContentionError,
    isPortCollisionError,
    isRetryableStartupError,
} = require('./setup.js');

// The observed CI failure from PR #654, verbatim in shape. mongodb-memory-server
// guards its binary download with a lockfile, so parallel Jest workers contend
// for it and one can lose. That is infrastructure timing, not a broken install,
// and it must not be able to turn a whole shard red.
const lockContentionErrors = [
    new Error('UnableToUnlockLockfileError: Cannot unlock file "/home/runner/.cache/mongodb-binaries/7.0.11.lock", because it is not locked by this process'),
    new Error('Cannot unlock file "/home/runner/.cache/mongodb-binaries/7.0.11.lock"'),
    { message: 'UnableToUnlockLockfileError' },
    'mongodb-binaries/7.0.11.lock is held by another process',
];

const portCollisionErrors = [
    new Error('Port 45123 is already in use'),
    new Error('listen EADDRINUSE: address already in use 127.0.0.1:45123'),
    { message: 'EADDRINUSE' },
];

const realFailures = [
    new Error('Could not find MongoDB binary for platform linux-x64'),
    new Error('Instance failed to start: unsupported CPU instructions'),
    new Error('ECONNREFUSED 127.0.0.1:27017'),
    new Error('Replica set primary never elected'),
    new Error(''),
];

describe('in-memory MongoDB startup retry classification', () => {
    it('treats binary download lock contention as retryable', () => {
        for (const error of lockContentionErrors) {
            expect(isBinaryLockContentionError(error)).toBe(true);
            expect(isRetryableStartupError(error)).toBe(true);
        }
    });

    it('keeps treating port collisions as retryable', () => {
        for (const error of portCollisionErrors) {
            expect(isPortCollisionError(error)).toBe(true);
            expect(isRetryableStartupError(error)).toBe(true);
        }
    });

    it('does not retry genuine startup failures', () => {
        for (const error of realFailures) {
            expect(isRetryableStartupError(error)).toBe(false);
        }
    });

    // A classifier that retried everything would make real failures slow and
    // still fail, so the two buckets must stay disjoint.
    it('does not confuse lock contention with a port collision', () => {
        for (const error of lockContentionErrors) {
            expect(isPortCollisionError(error)).toBe(false);
        }
        for (const error of portCollisionErrors) {
            expect(isBinaryLockContentionError(error)).toBe(false);
        }
    });

    it('tolerates missing and non-Error inputs', () => {
        for (const input of [undefined, null, {}, 42]) {
            expect(isRetryableStartupError(input)).toBe(false);
            expect(isBinaryLockContentionError(input)).toBe(false);
            expect(isPortCollisionError(input)).toBe(false);
        }
    });
});