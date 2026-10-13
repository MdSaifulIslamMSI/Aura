import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// DPoP client-contract test: proves createDpopProof emits a proof the
// server's verifyDpopProof accepts (server/utils/dpop.js checks typ, alg,
// ES256 JWK binding, ECDSA signature, HTM, HTU, iat freshness, jti).
//
// The existing apiBase.test.js only covers the failure path (IndexedDB
// hangs -> proceed without a proof). Nothing proved the happy path emits a
// valid, correctly signed token, so the client/server contract was untested.

const DPOP_DB_NAME = 'aura_dpop_keys';
const DPOP_STORE_NAME = 'keys';
const DPOP_KEY_ID = 'browser-session-binding-v1';

// Minimal in-memory IndexedDB stand-in: apiBase persists the ECDSA key pair
// here so it survives reloads, and reads it back before signing.
const createIndexedDbMock = () => {
    const records = new Map();

    const makeRequest = () => {
        const request = {};
        queueMicrotask(() => {
            if (request.onsuccess) request.onsuccess({ target: request });
        });
        return request;
    };

    const store = {
        get: (id) => {
            const request = makeRequest();
            queueMicrotask(() => {
                request.result = records.get(id) || undefined;
            });
            return request;
        },
        put: (value) => {
            const request = makeRequest();
            records.set(value.id, value);
            return request;
        },
    };

    const transaction = () => ({
        objectStore: () => store,
    });

    return {
        open: (name) => {
            const request = makeRequest();
            request.result = {
                objectStoreNames: { contains: () => false },
                createObjectStore: () => store,
                transaction,
            };
            return request;
        },
        __records: records,
    };
};

const decodeBase64Url = (value) =>
    JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

const parseProof = (proof) => {
    const parts = String(proof || '').split('.');
    expect(parts).toHaveLength(3);
    return {
        parts,
        header: decodeBase64Url(parts[0]),
        payload: decodeBase64Url(parts[1]),
        signature: Buffer.from(parts[2], 'base64url'),
        signingInput: `${parts[0]}.${parts[1]}`,
    };
};

// Convert the raw IEEE-P1363 (r||s) signature WebCrypto produces into DER,
// which Node's crypto.verify expects for ES256.
const p1363ToDer = (signature) => {
    const r = signature.subarray(0, 32);
    const s = signature.subarray(32, 64);
    const encodeInt = (bytes) => {
        let offset = 0;
        while (offset < bytes.length && bytes[offset] === 0) offset += 1;
        let value = bytes.subarray(offset);
        if (value[0] & 0x80) {
            value = Buffer.concat([Buffer.from([0]), value]);
        }
        return Buffer.concat([Buffer.from([0x02, value.length]), value]);
    };
    const body = Buffer.concat([encodeInt(r), encodeInt(s)]);
    return Buffer.concat([Buffer.from([0x30, body.length]), body]);
};

describe('createDpopProof client contract', () => {
    let originalIndexedDb;

    beforeEach(() => {
        originalIndexedDb = window.indexedDB;
        Object.defineProperty(window, 'indexedDB', {
            configurable: true,
            value: createIndexedDbMock(),
        });
    });

    afterEach(() => {
        Object.defineProperty(window, 'indexedDB', {
            configurable: true,
            value: originalIndexedDb,
        });
        vi.resetModules();
    });

    it('emits a well-formed ES256 proof whose signature verifies against its own JWK', async () => {
        const { createDpopProof } = await import('./apiBase');
        const proof = await createDpopProof('POST', '/api/auth/session');

        expect(typeof proof).toBe('string');
        const { header, payload, signature, signingInput } = parseProof(proof);

        // Header claims the server enforces (dpop.js lines 96-104).
        expect(header.typ).toBe('dpop+jwt');
        expect(header.alg).toBe('ES256');
        expect(header.jwk).toMatchObject({ kty: 'EC', crv: 'P-256' });
        expect(typeof header.jwk.x).toBe('string');
        expect(typeof header.jwk.y).toBe('string');
        // The embedded JWK carries public material only.
        expect(header.jwk).not.toHaveProperty('d');
        expect(header.jwk).not.toHaveProperty('privateKey');

        // Payload claims the server enforces (dpop.js lines 135-175).
        expect(payload.htm).toBe('POST');
        expect(payload.htu).toMatch(/\/api\/auth\/session$/);
        expect(payload.htu).not.toContain('?');
        expect(Number.isInteger(payload.iat)).toBe(true);
        // Freshness window is 60s server-side; a client clock skew beyond it
        // would be rejected, so assert the proof is stamped for "now".
        const age = Math.abs(Math.floor(Date.now() / 1000) - payload.iat);
        expect(age).toBeLessThanOrEqual(5);
        expect(typeof payload.jti).toBe('string');
        expect(payload.jti.length).toBeGreaterThan(10);

        // The signature must verify with the public key the header declares.
        const { createPublicKey, verify } = await import('node:crypto');
        const publicKey = createPublicKey({ key: header.jwk, format: 'jwk' });
        const verified = verify(
            'sha256',
            Buffer.from(signingInput),
            { key: publicKey, dsaEncoding: 'der' },
            p1363ToDer(signature),
        );
        expect(verified).toBe(true);
    });

    it('persists the key pair so a second proof reuses the same binding key', async () => {
        const { createDpopProof } = await import('./apiBase');
        const first = await createDpopProof('GET', '/api/products');
        const second = await createDpopProof('GET', '/api/products');

        const firstHeader = parseProof(first).header;
        const secondHeader = parseProof(second).header;

        // Same browser, same session binding: the public key must be stable
        // across requests, or the server's stored dpopJwk would never match.
        expect(secondHeader.jwk.x).toBe(firstHeader.jwk.x);
        expect(secondHeader.jwk.y).toBe(firstHeader.jwk.y);

        // ...while each proof is unique (fresh jti prevents replay rejection).
        expect(parseProof(second).payload.jti).not.toBe(parseProof(first).payload.jti);
    });

    it('returns null instead of throwing when WebCrypto is unavailable', async () => {
        const originalCrypto = window.crypto;
        Object.defineProperty(window, 'crypto', {
            configurable: true,
            value: { ...originalCrypto, subtle: undefined },
        });

        try {
            vi.resetModules();
            const { createDpopProof } = await import('./apiBase');
            const proof = await createDpopProof('GET', '/api/products');
            // The request path degrades to a bearer request rather than
            // crashing; the server still enforces its own contract.
            expect(proof).toBeNull();
        } finally {
            Object.defineProperty(window, 'crypto', {
                configurable: true,
                value: originalCrypto,
            });
        }
    });

    it('stores the key pair under the documented IndexedDB identity', async () => {
        const { createDpopProof } = await import('./apiBase');
        await createDpopProof('GET', '/api/products');

        const db = window.indexedDB;
        expect(db.__records.has(DPOP_KEY_ID)).toBe(true);
        const stored = db.__records.get(DPOP_KEY_ID);
        expect(stored.keyPair.privateKey).toBeTruthy();
        expect(stored.keyPair.publicKey).toBeTruthy();
        expect(stored.createdAt).toBeTruthy();
    });
});
