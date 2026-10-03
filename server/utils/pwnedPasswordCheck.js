/**
 * HIBP breached-password check (k-anonymity range API).
 *
 * Only the first 5 hex characters of the k-anonymity hash leave the server; the
 * API returns every suffix sharing that prefix plus an occurrence count. The
 * hash function is fixed by the HIBP range API protocol.
 * Any failure (network outage, timeout, non-2xx) fails open so a third-party
 * outage can never block password recovery.
 */

const crypto = require('crypto');

const PWNED_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const REQUEST_TIMEOUT_MS = 1500;

const CLEAN_RESULT = Object.freeze({ pwned: false, count: 0, checked: false });

/**
 * Check a candidate password against the Have I Been Pwned password corpus.
 * @param {string} password - Plaintext candidate password (never logged, never sent).
 * @returns {Promise<{pwned: boolean, count: number, checked: boolean}>}
 *   `checked: false` means the lookup could not be completed (fail-open).
 */
const checkPwnedPassword = async (password) => {
    if (!password || typeof password !== 'string') {
        return CLEAN_RESULT;
    }

    try {
        // The hash function is fixed by the HIBP range API protocol: it is a k-anonymity
        // lookup token for an external breach-corpus API, never used to store or verify
        // a password. Accepted in config/security/pqc-allowlist.json (SHA1_SIGNATURE_OR_INTEGRITY).
        const hash = crypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase(); // nosemgrep: security.semgrep.nodejs-sha1 - HIBP protocol hash, not a security primitive // codeql[js/insufficient-password-hash]
        const prefix = hash.slice(0, 5);
        const suffix = hash.slice(5);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let response;
        try {
            response = await fetch(`${PWNED_RANGE_URL}${prefix}`, {
                method: 'GET',
                signal: controller.signal,
                headers: { 'Add-Padding': 'true' },
            });
        } finally {
            clearTimeout(timer);
        }

        if (!response.ok) {
            return CLEAN_RESULT;
        }

        const body = await response.text();
        for (const line of body.split('\n')) {
            const separatorIndex = line.indexOf(':');
            if (separatorIndex === -1) {
                continue;
            }
            if (line.slice(0, separatorIndex).trim() !== suffix) {
                continue;
            }
            const count = parseInt(line.slice(separatorIndex + 1).trim(), 10);
            if (Number.isFinite(count) && count > 0) {
                return { pwned: true, count, checked: true };
            }
            return CLEAN_RESULT;
        }
        return { pwned: false, count: 0, checked: true };
    } catch {
        return CLEAN_RESULT;
    }
};

module.exports = { checkPwnedPassword };
