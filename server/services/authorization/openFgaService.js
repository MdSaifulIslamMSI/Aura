/**
 * OpenFGA authorization service â€” fine-grained ReBAC for the marketplace
 * (Phase 4). Plain-fetch client, no SDK. Injectable for tests.
 *
 * Rollout modes (OPENFGA_ENFORCEMENT_MODE): off (default, legacy stands),
 * monitor (FGA evaluated + disagreements logged, legacy decides), enforce
 * (FGA is the authority; transport errors fail CLOSED; backfill required).
 *
 * Model: listing(owner, admin, editor), order(buyer, seller, admin, viewer)
 * â€” see infra/security/openfga/authorization-model.json.
 */
const ENFORCEMENT_MODES = Object.freeze(['off', 'monitor', 'enforce']);

const resolveConfig = (overrides = {}) => {
    const requestedMode = overrides.enforcementMode || process.env.OPENFGA_ENFORCEMENT_MODE || 'off';
    return {
        apiUrl: (overrides.apiUrl || process.env.OPENFGA_API_URL || '').replace(/\/$/, ''),
        storeId: overrides.storeId || process.env.OPENFGA_STORE_ID || '',
        authorizationModelId: overrides.authorizationModelId || process.env.OPENFGA_AUTHORIZATION_MODEL_ID || '',
        apiToken: overrides.apiToken || process.env.OPENFGA_API_TOKEN || '',
        enforcementMode: ENFORCEMENT_MODES.includes(requestedMode) ? requestedMode : 'off',
        timeoutMs: Number(overrides.timeoutMs || process.env.OPENFGA_TIMEOUT_MS || 3000),
    };
};

const buildHeaders = (config) => {
    const headers = { 'content-type': 'application/json' };
    if (config.apiToken) headers.authorization = `Bearer ${config.apiToken}`;
    return headers;
};

const createRequestSender = (config, fetchFn) => async (urlPath, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
        const response = await fetchFn(`${config.apiUrl}${urlPath}`, {
            method: 'POST',
            headers: buildHeaders(config),
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(`OpenFGA ${urlPath} failed (${response.status}): ${payload.message || 'unknown error'}`);
        }
        return payload;
    } finally {
        clearTimeout(timer);
    }
};

const createOpenFgaService = (configOverrides = {}, { fetchImpl } = {}) => {
    const fetchFn = fetchImpl || globalThis.fetch.bind(globalThis);
    const config = resolveConfig(configOverrides);
    const isConfigured = Boolean(config.apiUrl && config.storeId);
    const enforcementMode = isConfigured ? config.enforcementMode : 'off';
    const send = createRequestSender(config, fetchFn);

    const checkRelation = async ({ userId, relation, object }) => {
        if (!isConfigured) throw new Error('OpenFGA is not configured (OPENFGA_API_URL / OPENFGA_STORE_ID missing).');
        const payload = await send(`/stores/${config.storeId}/check`, {
            tuple_key: { user: `user:${userId}`, relation, object },
            authorization_model_id: config.authorizationModelId || undefined,
        });
        return payload.allowed === true;
    };

    const writeTuples = async (tupleKeys) => {
        if (!isConfigured) throw new Error('OpenFGA is not configured (OPENFGA_API_URL / OPENFGA_STORE_ID missing).');
        if (!Array.isArray(tupleKeys) || tupleKeys.length === 0) return { written: 0 };
        await send(`/stores/${config.storeId}/write`, {
            writes: { tuple_keys: tupleKeys },
            authorization_model_id: config.authorizationModelId || undefined,
        });
        return { written: tupleKeys.length };
    };

    // Best-effort tuple sync: a failed write must never fail the user
    // operation. Monitor/enforce rollouts rely on backfill for the rest.
    const recordTuple = async ({ userId, relation, object }) => {
        if (!isConfigured || enforcementMode === 'off') return { written: 0, skipped: true };
        try {
            return { ...(await writeTuples([{ user: `user:${userId}`, relation, object }])), skipped: false };
        } catch (error) {
            return { written: 0, skipped: false, error: error.message };
        }
    };

    // Listing edit/delete authorization. `legacyAllowed` is the existing
    // seller-identity check; FGA adds admin/editor relations on top.
    const authorizeListingEditor = async ({ userId, listingId, legacyAllowed }) => {
        if (enforcementMode === 'off') {
            return { allowed: legacyAllowed, enforced: false, mode: 'off', fgaChecked: false };
        }
        let fgaAllowed = null;
        let fgaError = null;
        try {
            fgaAllowed = await checkRelation({ userId, relation: 'editor', object: `listing:${listingId}` });
        } catch (error) {
            fgaError = error.message;
        }
        if (fgaError !== null) {
            if (enforcementMode === 'enforce') {
                // Fail closed: a broken authorization service must not widen
                // access; the legacy check alone is not trusted in enforce.
                return { allowed: false, enforced: true, mode: 'enforce', fgaChecked: false, fgaError };
            }
            return { allowed: legacyAllowed, enforced: false, mode: 'monitor', fgaChecked: false, fgaError };
        }
        if (enforcementMode === 'monitor') {
            return {
                allowed: legacyAllowed,
                enforced: false,
                mode: 'monitor',
                fgaChecked: true,
                fgaAllowed,
                disagreement: fgaAllowed !== legacyAllowed,
            };
        }
        return { allowed: fgaAllowed === true, enforced: true, mode: 'enforce', fgaChecked: true, fgaAllowed };
    };

    return {
        config,
        isConfigured,
        getEnforcementMode: () => enforcementMode,
        checkRelation,
        writeTuples,
        recordTuple,
        authorizeListingEditor,
    };
};

const defaultService = createOpenFgaService();

module.exports = {
    ENFORCEMENT_MODES,
    createOpenFgaService,
    defaultService,
    authorizeListingEditor: (input) => defaultService.authorizeListingEditor(input),
    recordListingOwnerTuple: ({ userId, listingId }) => defaultService.recordTuple({
        userId,
        relation: 'owner',
        object: `listing:${listingId}`,
    }),
};
