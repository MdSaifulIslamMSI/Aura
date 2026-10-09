const crypto = require('crypto');
const AppError = require('../utils/AppError');
const { deriveHmacKey } = require('../utils/cryptoKdf');

// Deterministic keyed hashes (blind indexes) that preserve EQUALITY search over
// encrypted-at-rest fields. The hash is computed from the exact stored value, so
// `field: { $in: values }` becomes `fieldHash: { $in: values.map(hash) }` with
// identical matching semantics (including historical format quirks), while the
// plaintext itself can be encrypted. Uniqueness indexes move onto the hash with
// unchanged conflict behavior (HMAC is deterministic + collision-resistant).
//
// The secret is a server-side pepper: the index reveals nothing without it.
//
// ── TWO DERIVATIONS, DELIBERATELY ────────────────────────────────────────────
// `compute*BlindIndex` (v1) keys HMAC directly with the raw configured secret.
// Every phoneHash/recipientEmailHash already in the database was produced that
// way, so v1 is FROZEN and must keep working forever as a read path.
//
// `compute*BlindIndexV2` (v2) derives an HKDF subkey first, which buys real
// domain separation: the index key is no longer byte-identical to the secret
// used anywhere else, so recovering one capability no longer yields another.
//
// Migrating v1 → v2 was a data migration, staged and now COMPLETE:
//   1. dual-write both fields      (model hooks, this file)      — done
//   2. dual-read either field      (the *Candidates query helpers) — retired
//   3. backfill existing rows      (scripts/backfill-blind-indexes.js) — done
//   4. drop the v1 field + index   (migrations 2026-10-09-drop-blind-index-*
//                                    v1-indexes / -legacy-ciphertext-indexes) — done
// Since step 4, only v2 is written and queried. The v1 compute functions stay
// exported, FROZEN, for the migration tooling (the backfill verifies stored
// v1 hashes against them); no request-path code may call them again.

// Frozen HKDF contexts. Never edited once shipped; a future change means v3.
const PHONE_INDEX_CONTEXT = 'blind-index.phone.v2';
const EMAIL_INDEX_CONTEXT = 'blind-index.email.v2';

const isProduction = () => String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';

const getPhoneBlindIndexSecret = () => {
    const secret = String(
        process.env.PHONE_BLIND_INDEX_SECRET
        || process.env.OTP_FLOW_SECRET
        || process.env.JWT_SECRET
        || ''
    ).trim();
    if (secret) return secret;
    if (process.env.NODE_ENV === 'test') return 'aura-test-phone-blind-index-secret';
    throw new AppError('Phone blind index secret is not configured', 500);
};

const getEmailBlindIndexSecret = () => {
    const secret = String(
        process.env.EMAIL_BLIND_INDEX_SECRET
        || process.env.OTP_FLOW_SECRET
        || process.env.JWT_SECRET
        || ''
    ).trim();
    if (secret) return secret;
    if (process.env.NODE_ENV === 'test') return 'aura-test-email-blind-index-secret';
    throw new AppError('Email blind index secret is not configured', 500);
};

/**
 * Refuse to fall back to a shared secret in production.
 *
 * The fallback chain above exists so a partially-configured environment keeps
 * working. In production that is exactly the wrong default: it silently gives
 * phone-index, email-index, OTP-flow and JWT signing the same key material, so
 * leaking one capability leaks the others. The dedicated variables are already
 * part of the AWS Parameter Store contract (server/config/runtimeConfig.js), so
 * requiring them here breaks nothing that is configured correctly.
 */
const assertBlindIndexSecretIsolation = () => {
    if (!isProduction()) return;

    const phoneDedicated = String(process.env.PHONE_BLIND_INDEX_SECRET || '').trim();
    const emailDedicated = String(process.env.EMAIL_BLIND_INDEX_SECRET || '').trim();
    const shared = String(process.env.OTP_FLOW_SECRET || process.env.JWT_SECRET || '').trim();

    if (!phoneDedicated && !emailDedicated) {
        throw new Error(
            'PHONE_BLIND_INDEX_SECRET and EMAIL_BLIND_INDEX_SECRET must be configured in production; '
            + 'falling back to the shared OTP/JWT secret removes domain separation between blind indexes and token signing'
        );
    }

    if (!phoneDedicated && shared) {
        throw new Error('PHONE_BLIND_INDEX_SECRET must be configured in production instead of reusing the shared OTP/JWT secret');
    }

    if (!emailDedicated && shared) {
        throw new Error('EMAIL_BLIND_INDEX_SECRET must be configured in production instead of reusing the shared OTP/JWT secret');
    }
};

// ── v1 (frozen) ──────────────────────────────────────────────────────────────
const computeBlindIndex = (value, secret) => crypto
    .createHmac('sha256', secret)
    .update(String(value ?? ''))
    .digest('hex');

// ── v2 (HKDF-derived) ───────────────────────────────────────────────────────
// deriveHmacKey returns raw key BYTES, so it is passed as the key argument to
// createHmac — it is not itself an Hmac object.
const computeBlindIndexV2 = (value, secret, context) => crypto
    .createHmac('sha256', deriveHmacKey({ secret, context }))
    .update(String(value ?? ''))
    .digest('hex');

// The exact stored value: User.phone's schema setter normalizes (trim/strip),
// so hashing the post-setter value keeps hash <-> ciphertext consistent.
const computePhoneBlindIndex = (phone) => (
    phone === undefined || phone === null || phone === ''
        ? null
        : computeBlindIndex(String(phone), getPhoneBlindIndexSecret())
);

const computePhoneBlindIndexV2 = (phone) => (
    phone === undefined || phone === null || phone === ''
        ? null
        : computeBlindIndexV2(String(phone), getPhoneBlindIndexSecret(), PHONE_INDEX_CONTEXT)
);

const normalizeEmailForIndex = (value) => String(value ?? '').trim().toLowerCase();

const computeEmailBlindIndex = (email) => {
    const normalized = normalizeEmailForIndex(email);
    return normalized ? computeBlindIndex(normalized, getEmailBlindIndexSecret()) : null;
};

const computeEmailBlindIndexV2 = (email) => {
    const normalized = normalizeEmailForIndex(email);
    return normalized
        ? computeBlindIndexV2(normalized, getEmailBlindIndexSecret(), EMAIL_INDEX_CONTEXT)
        : null;
};

// ── Query helpers ────────────────────────────────────────────────────────────
// The dual-read *Candidates helpers that lived here were removed with the
// step-4 retirement: every query site matches phoneHashV2 /
// recipientEmailHashV2 directly (see buildPhoneMatchFilter,
// listAdminUsers, buildSearchQuery in emailOpsAdminService).

module.exports = {
    computePhoneBlindIndex,
    computeEmailBlindIndex,
    computePhoneBlindIndexV2,
    computeEmailBlindIndexV2,
    normalizeEmailForIndex,
    assertBlindIndexSecretIsolation,
    PHONE_INDEX_CONTEXT,
    EMAIL_INDEX_CONTEXT,
};
