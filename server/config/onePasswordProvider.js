'use strict';

/**
 * 1Password Connect secrets provider (opt-in, dependency-free).
 *
 * Resolves `op://vault/item/field` (or `op://vault/item/section/field`)
 * references from process.env into memory before the API/worker boots.
 * AWS SSM remains the default; this provider only runs when explicitly
 * enabled or when an `op://` reference is present alongside Connect config.
 *
 * Security contract:
 * - Never logs secret values or the Connect token (errors carry names only).
 * - Fail-closed when explicitly enabled: missing config or failed lookup throws.
 * - Optional vault allowlist bounds which vaults can be read.
 * - Uses global fetch only (no new runtime dependencies).
 */

const { safeString } = require('../utils/safeString');

const OP_REFERENCE_PREFIX = 'op://';
const DEFAULT_TIMEOUT_MS = 5000;

const parseBoolean = (value, fallback = false) => {
    const normalized = safeString(value).toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const uniq = (values = []) => [...new Set(values.map((v) => safeString(v)).filter(Boolean))];

const isOnePasswordReference = (value = '') => safeString(value).toLowerCase().startsWith(OP_REFERENCE_PREFIX);

const parseOnePasswordReference = (ref = '') => {
    const normalized = safeString(ref);
    if (!isOnePasswordReference(normalized)) {
        throw new Error('onepassword_reference_invalid');
    }
    const parts = normalized.slice(OP_REFERENCE_PREFIX.length).split('/').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) {
        throw new Error('onepassword_reference_invalid');
    }
    if (parts.some((p) => p.length > 128)) {
        throw new Error('onepassword_reference_invalid');
    }
    const [vault, item] = parts;
    if (parts.length === 3) {
        return { vault, item, section: '', field: parts[2] };
    }
    return { vault, item, section: parts[2], field: parts[3] };
};

const resolveOnePasswordConfig = (env = process.env) => {
    const host = safeString(env.OP_CONNECT_HOST || '').replace(/\/+$/, '');
    const token = safeString(env.OP_CONNECT_TOKEN || '');
    const vaultAllowlist = uniq(safeString(env.OP_CONNECT_VAULT_ALLOWLIST || '').split(','));
    const timeoutMs = Number.parseInt(safeString(env.OP_CONNECT_TIMEOUT_MS || ''), 10) || DEFAULT_TIMEOUT_MS;
    const required = parseBoolean(env.ONEPASSWORD_REQUIRED, false);
    const explicitlyEnabled = parseBoolean(env.ONEPASSWORD_ENABLED, false)
        || safeString(env.RUNTIME_SECRETS_PROVIDER || '').toLowerCase().includes('onepassword');

    let itemMap = {};
    const rawMap = safeString(env.OP_CONNECT_ITEM_MAP || '');
    if (rawMap) {
        try {
            const parsed = JSON.parse(rawMap);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('not_an_object');
            }
            itemMap = parsed;
        } catch (error) {
            throw new Error(`onepassword_item_map_invalid:${safeString(error.message).slice(0, 80)}`);
        }
    }

    return {
        host,
        token,
        vaultAllowlist,
        timeoutMs: Math.min(Math.max(timeoutMs, 1000), 30000),
        required,
        explicitlyEnabled,
        itemMap,
    };
};

const redactHost = (host = '') => {
    const clean = safeString(host);
    if (!clean) return '(unset)';
    return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean;
};

const connectHeaders = (token = '') => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
});

const fetchJson = async (url, token, timeoutMs, fetcher) => {
    const impl = fetcher || fetch;
    const response = await impl(url, {
        method: 'GET',
        headers: connectHeaders(token),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    if (!response || !response.ok) {
        throw new Error(`onepassword_connect_http_${response ? response.status : 'unreachable'}`);
    }
    return response.json();
};

const resolveVaultId = async ({ host, token, timeoutMs, vault, cache, fetcher }) => {
    if (cache.vaultIds.has(vault.toLowerCase())) return cache.vaultIds.get(vault.toLowerCase());
    const vaults = await fetchJson(`${host}/v1/vaults`, token, timeoutMs, fetcher);
    const match = (Array.isArray(vaults) ? vaults : []).find(
        (v) => safeString(v.name).toLowerCase() === vault.toLowerCase() || String(v.id || '') === vault
    );
    if (!match || !match.id) throw new Error('onepassword_vault_not_found');
    cache.vaultIds.set(vault.toLowerCase(), String(match.id));
    return String(match.id);
};

const resolveItemId = async ({ host, token, timeoutMs, vaultId, item, cacheKey, cache, fetcher }) => {
    if (cache.itemIds.has(cacheKey)) return cache.itemIds.get(cacheKey);
    const items = await fetchJson(`${host}/v1/vaults/${encodeURIComponent(vaultId)}/items`, token, timeoutMs, fetcher);
    const match = (Array.isArray(items) ? items : []).find(
        (i) => safeString(i.title).toLowerCase() === item.toLowerCase() || String(i.id || '') === item
    );
    if (!match || !match.id) throw new Error('onepassword_item_not_found');
    cache.itemIds.set(cacheKey, String(match.id));
    return String(match.id);
};

const resolveFieldValue = (itemDetail = {}, section = '', field = '') => {
    const fields = Array.isArray(itemDetail.fields) ? itemDetail.fields : [];
    const wantField = field.toLowerCase();
    const wantSection = section.toLowerCase();
    const match = fields.find((f) => {
        const labelHit = safeString(f.label).toLowerCase() === wantField || safeString(f.id).toLowerCase() === wantField;
        if (!labelHit) return false;
        if (!wantSection) return true;
        return safeString(f.section && (f.section.label || f.section.id)).toLowerCase() === wantSection;
    });
    const value = match ? safeString(match.value || '') : '';
    if (!value) throw new Error('onepassword_field_not_found');
    return value;
};

/**
 * Prime process.env from 1Password Connect. Pure wrt logging (never logs values).
 * @returns {{enabled:boolean, source:string, loadedKeys:string[], skippedKeys:string[]}}
 */
const primeOnePasswordEnv = async ({ env = process.env, secretKeys = [], logger = console, fetcher } = {}) => {
    const config = resolveOnePasswordConfig(env);
    const { host, token, vaultAllowlist, timeoutMs, itemMap } = config;

    const refs = new Map();
    for (const key of uniq(secretKeys)) {
        const mapped = safeString(itemMap[key] || '');
        const current = safeString(env[key] || '');
        const ref = mapped || (isOnePasswordReference(current) ? current : '');
        if (ref) refs.set(key, ref);
    }

    const autoDetected = refs.size > 0;
    const enabled = config.explicitlyEnabled || config.required || autoDetected;
    if (!enabled) {
        return { enabled: false, source: 'onepassword_disabled', loadedKeys: [], skippedKeys: [] };
    }
    if (!host || !token) {
        throw new Error(`onepassword_config_missing: set OP_CONNECT_HOST and OP_CONNECT_TOKEN (host=${redactHost(host)})`);
    }

    const cache = { vaultIds: new Map(), itemIds: new Map(), values: new Map() };
    const loadedKeys = [];
    const skippedKeys = [];
    const failClosed = config.explicitlyEnabled || config.required;

    for (const [envName, ref] of refs.entries()) {
        try {
            const parsed = parseOnePasswordReference(ref);
            if (vaultAllowlist.length > 0 && !vaultAllowlist.map((v) => v.toLowerCase()).includes(parsed.vault.toLowerCase())) {
                throw new Error('onepassword_vault_not_allowed');
            }
            const cacheKey = `${parsed.vault.toLowerCase()}/${parsed.item.toLowerCase()}/${parsed.section.toLowerCase()}/${parsed.field.toLowerCase()}`;
            if (!cache.values.has(cacheKey)) {
                const vaultId = await resolveVaultId({ host, token, timeoutMs, vault: parsed.vault, cache, fetcher });
                const itemKey = `${vaultId}/${parsed.item.toLowerCase()}`;
                const itemId = await resolveItemId({ host, token, timeoutMs, vaultId, item: parsed.item, cacheKey: itemKey, cache, fetcher });
                const detail = await fetchJson(
                    `${host}/v1/vaults/${encodeURIComponent(vaultId)}/items/${encodeURIComponent(itemId)}`,
                    token, timeoutMs, fetcher
                );
                cache.values.set(cacheKey, resolveFieldValue(detail, parsed.section, parsed.field));
            }
            env[envName] = cache.values.get(cacheKey);
            loadedKeys.push(envName);
        } catch (error) {
            if (failClosed) {
                throw new Error(`onepassword_resolve_failed:${envName}:${safeString(error.message).slice(0, 80)}`);
            }
            skippedKeys.push(envName);
            logger?.warn?.('runtime.onepassword_skipped', { key: envName });
        }
    }

    logger?.info?.('runtime.onepassword_primed', {
        host: redactHost(host),
        loadedKeyCount: loadedKeys.length,
        skippedKeyCount: skippedKeys.length,
    });

    return { enabled: true, source: 'onepassword_connect', loadedKeys, skippedKeys };
};

module.exports = {
    isOnePasswordReference,
    parseOnePasswordReference,
    resolveOnePasswordConfig,
    primeOnePasswordEnv,
};
