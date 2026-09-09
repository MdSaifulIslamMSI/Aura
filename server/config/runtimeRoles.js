// Runtime role resolution for the split API/worker deployment.
//
// SPLIT_RUNTIME_ENABLED=true is only safe when the API can actually observe
// the dedicated worker process: readiness gates on its health endpoint via
// WORKER_HEALTH_URL. Without that URL the API keeps running the workers
// itself (legacy single-process behavior) instead of delegating blind.

const parseTrueFlag = (value) => String(value || '').trim().toLowerCase() === 'true';

const isSplitRuntimeEnabled = (env = process.env) => parseTrueFlag(env.SPLIT_RUNTIME_ENABLED);

const shouldRunBackgroundWorkers = (env = process.env) => {
    if (!isSplitRuntimeEnabled(env)) return true;
    return !String(env.WORKER_HEALTH_URL || '').trim();
};

// Probe the worker process's ready endpoint; returns a gap list in the same
// shape as index.js's getSplitRuntimeWorkerGaps (empty = healthy).
const checkSplitRuntimeWorkerHealth = async ({ fetchImpl = fetch, env = process.env } = {}) => {
    const baseUrl = String(env.WORKER_HEALTH_URL || '').trim().replace(/\/+$/, '');
    if (!baseUrl) return ['worker_health_url_missing'];
    try {
        const response = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(2500) });
        if (!response.ok) return ['worker_process_unready'];
        const payload = await response.json();
        return payload?.worker?.ready ? [] : ['worker_process_unready'];
    } catch {
        return ['worker_process_unreachable'];
    }
};

module.exports = {
    isSplitRuntimeEnabled,
    shouldRunBackgroundWorkers,
    checkSplitRuntimeWorkerHealth,
};
