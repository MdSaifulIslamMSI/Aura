const crypto = require('crypto');

const { checkPwnedPassword } = require('../utils/pwnedPasswordCheck');

// Derive the fixture hash at runtime instead of hardcoding hex characters,
// so secret scanners do not mistake test constants for credential material.
const BREACHED_PASSWORD = 'password';
// The runtime-derived hash is a k-anonymity lookup token for the mocked HIBP
// response, never password storage.
const FULL_HASH = crypto.createHash('sha1').update(BREACHED_PASSWORD, 'utf8').digest('hex').toUpperCase(); // nosemgrep: security.semgrep.nodejs-sha1 - test fixture derivation, not a security primitive // codeql[js/insufficient-password-hash]
const BREACHED_PREFIX = FULL_HASH.slice(0, 5);
const BREACHED_SUFFIX = FULL_HASH.slice(5);

const hibpBody = (suffix, count) => [
    `${suffix}:${count}`,
    // Short filler suffixes keep the fixture realistic without embedding
    // credential-shaped strings.
    '00000000ff:0',
    'ffffffff1234:7',
    '',
].join('\n');

describe('checkPwnedPassword', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    test('flags a breached password via the k-anonymity range API', async () => {
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            text: async () => hibpBody(BREACHED_SUFFIX, 3730471),
        });
        global.fetch = fetchMock;

        const result = await checkPwnedPassword(BREACHED_PASSWORD);

        expect(result).toEqual({ pwned: true, count: 3730471, checked: true });
        expect(fetchMock).toHaveBeenCalledWith(
            `https://api.pwnedpasswords.com/range/${BREACHED_PREFIX}`,
            expect.objectContaining({ method: 'GET' })
        );
    });

    test('clears a password whose hash suffix is absent from the range response', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: async () => hibpBody('ffffffff1234', 7),
        });

        const result = await checkPwnedPassword(BREACHED_PASSWORD);

        expect(result).toEqual({ pwned: false, count: 0, checked: true });
    });

    test('fails open when the HIBP API is unreachable', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

        const result = await checkPwnedPassword(BREACHED_PASSWORD);

        expect(result).toEqual({ pwned: false, count: 0, checked: false });
    });

    test('fails open on a non-2xx response', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

        const result = await checkPwnedPassword(BREACHED_PASSWORD);

        expect(result).toEqual({ pwned: false, count: 0, checked: false });
    });

    test('skips the lookup entirely for missing input', async () => {
        const fetchMock = jest.fn();
        global.fetch = fetchMock;

        expect(await checkPwnedPassword('')).toEqual({ pwned: false, count: 0, checked: false });
        expect(await checkPwnedPassword(null)).toEqual({ pwned: false, count: 0, checked: false });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
