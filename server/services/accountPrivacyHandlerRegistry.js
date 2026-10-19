// Registry of the data-subject job handlers that are ACTUALLY wired into
// this process.
//
// The privacy worker takes its handlers by injection and nothing in the repo
// injects them, so a queued export/erasure job would sit in the queue forever
// while the capability endpoint advertised "export: true" to the visitor.
// This registry is the single source of truth for "can this job type be
// serviced right now", so the capability report, the request path and the
// worker cannot drift apart from what actually runs.
//
// Registering a handler is the ONLY way to make a job type serviceable:
//
//   registerAccountPrivacyHandlers({
//       export: async (job) => ({ status: 'ready', exportExpiresAt, artifactKeyEncrypted }),
//   });
//
// Until a real implementation registers one, every job type is unserviceable
// and the surface reports itself as unavailable instead of accepting work it
// cannot finish. A registration also needs a worker process that calls
// processNextPrivacyJob(); the registry alone does not drain the queue.

const CLAIMABLE_TYPES = Object.freeze(['export', 'deactivation', 'deletion']);

const registeredHandlers = new Map();

const registerAccountPrivacyHandlers = (handlers = {}) => {
    const registered = [];

    CLAIMABLE_TYPES.forEach((type) => {
        const handler = handlers?.[type];
        if (typeof handler !== 'function') {
            return;
        }
        registeredHandlers.set(type, handler);
        registered.push(type);
    });

    return registered;
};

const getRegisteredAccountPrivacyHandler = (type) => (
    registeredHandlers.get(String(type || '').trim()) || null
);

const hasAccountPrivacyHandler = (type) => (
    typeof getRegisteredAccountPrivacyHandler(type) === 'function'
);

const getRegisteredAccountPrivacyJobTypes = () => (
    CLAIMABLE_TYPES.filter((type) => hasAccountPrivacyHandler(type))
);

const getUnserviceableAccountPrivacyJobTypes = () => (
    CLAIMABLE_TYPES.filter((type) => !hasAccountPrivacyHandler(type))
);

const clearAccountPrivacyHandlers = () => {
    registeredHandlers.clear();
};

module.exports = {
    CLAIMABLE_TYPES,
    clearAccountPrivacyHandlers,
    getRegisteredAccountPrivacyHandler,
    getRegisteredAccountPrivacyJobTypes,
    getUnserviceableAccountPrivacyJobTypes,
    hasAccountPrivacyHandler,
    registerAccountPrivacyHandlers,
};
