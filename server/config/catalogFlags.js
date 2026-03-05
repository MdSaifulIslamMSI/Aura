const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const asLower = (value, fallback) => String(value || fallback).trim().toLowerCase();
const asPositiveInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
};

const nodeEnv = asLower(process.env.NODE_ENV, 'development');
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

const flags = {
    nodeEnv,
    isProduction,
    isTest,
    catalogImportsEnabled: parseBoolean(process.env.CATALOG_IMPORTS_ENABLED, true),
    catalogSyncEnabled: parseBoolean(process.env.CATALOG_SYNC_ENABLED, true),
    catalogActiveVersionRequired: parseBoolean(process.env.CATALOG_ACTIVE_VERSION_REQUIRED, true),
    catalogSearchIndexName: String(process.env.CATALOG_SEARCH_INDEX_NAME || 'products_search_v1').trim(),
    catalogSearchCheckOnBoot: parseBoolean(process.env.CATALOG_SEARCH_CHECK_ON_BOOT, !isTest),
    catalogSyncIntervalMs: asPositiveInt(process.env.CATALOG_SYNC_INTERVAL_MS, 15 * 60 * 1000),
    catalogImportWorkerPollMs: asPositiveInt(process.env.CATALOG_IMPORT_WORKER_POLL_MS, 5000),
    catalogDefaultSyncProvider: String(process.env.CATALOG_DEFAULT_SYNC_PROVIDER || 'file').trim().toLowerCase(),
    catalogProviderSourceRef: String(process.env.CATALOG_PROVIDER_SOURCE_REF || '').trim(),
};

module.exports = {
    flags,
    parseBoolean,
};
