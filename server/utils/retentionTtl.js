const DEFAULT_RETENTION_DAYS = 90;
const MAX_RETENTION_DAYS = 3650;

// TTL expireAfterSeconds for telemetry collections. The env var is read once
// at model load time; changing the value in a live deployment requires
// dropping and recreating the TTL index (documented in docs/database-audit).
const resolveRetentionSeconds = ({ envVar, defaultDays = DEFAULT_RETENTION_DAYS } = {}) => {
    const raw = envVar ? process.env[envVar] : '';
    const parsed = Number.parseInt(String(raw || ''), 10);
    const days = Number.isFinite(parsed) && parsed >= 1
        ? Math.min(parsed, MAX_RETENTION_DAYS)
        : defaultDays;
    return days * 24 * 60 * 60;
};

module.exports = {
    resolveRetentionSeconds,
    DEFAULT_RETENTION_DAYS,
    MAX_RETENTION_DAYS,
};
