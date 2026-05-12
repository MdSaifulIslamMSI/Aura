const DEFAULT_NON_PRODUCTION_BOOT_GRACE_PERIOD_SEC = 900;

const getBootGracePeriodSec = ({
    env = process.env,
    runtimeNodeEnv = process.env.NODE_ENV || 'production',
} = {}) => {
    const configuredBootGracePeriod = Number(env.BOOT_GRACE_PERIOD_SEC);
    if (Number.isFinite(configuredBootGracePeriod)) {
        return Math.max(0, configuredBootGracePeriod);
    }

    return runtimeNodeEnv === 'production'
        ? 0
        : DEFAULT_NON_PRODUCTION_BOOT_GRACE_PERIOD_SEC;
};

const getReadinessGraceState = ({
    env = process.env,
    runtimeNodeEnv = process.env.NODE_ENV || 'production',
    uptime = process.uptime(),
} = {}) => {
    const bootGracePeriodSec = getBootGracePeriodSec({ env, runtimeNodeEnv });
    return {
        bootGracePeriodSec,
        isWithinGracePeriod: uptime < bootGracePeriodSec,
    };
};

const buildStartupReadinessFailure = ({
    runtimeNodeEnv = process.env.NODE_ENV || 'production',
    runtimeStartupState = {},
    isWithinGracePeriod = false,
    uptime = 0,
    timestamp = new Date().toISOString(),
} = {}) => {
    if (runtimeStartupState.asyncStartupError && !isWithinGracePeriod) {
        return {
            ready: false,
            reason: 'async_startup_failed',
            uptime,
            timestamp,
            startup: {
                asyncStartupComplete: Boolean(runtimeStartupState.asyncStartupComplete),
                asyncStartupHealthy: false,
            },
        };
    }

    if (runtimeNodeEnv === 'production' && !runtimeStartupState.asyncStartupComplete && !isWithinGracePeriod) {
        return {
            ready: false,
            reason: 'async_startup_incomplete',
            uptime,
            timestamp,
            startup: {
                asyncStartupComplete: false,
                asyncStartupHealthy: true,
            },
        };
    }

    return null;
};

module.exports = {
    DEFAULT_NON_PRODUCTION_BOOT_GRACE_PERIOD_SEC,
    getBootGracePeriodSec,
    getReadinessGraceState,
    buildStartupReadinessFailure,
};
