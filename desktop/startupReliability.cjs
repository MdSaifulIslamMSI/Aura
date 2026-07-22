const DEFAULT_DESKTOP_STARTUP_BUDGET_MS = 3000;

const runWithTimeout = (task, timeoutMs, message = 'Desktop startup task timed out.') => {
    const duration = Number(timeoutMs);
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('Desktop startup timeout must be a positive number.');
    }

    let timeoutId;
    const timeout = new Promise((_resolve, reject) => {
        timeoutId = setTimeout(() => {
            const error = new Error(message);
            error.code = 'ETIMEDOUT';
            reject(error);
        }, duration);
    });

    return Promise.race([
        Promise.resolve().then(() => (typeof task === 'function' ? task() : task)),
        timeout,
    ]).finally(() => clearTimeout(timeoutId));
};

const evaluateDesktopStartup = ({
    startedAt,
    finishedAt,
    budgetMs = DEFAULT_DESKTOP_STARTUP_BUDGET_MS,
} = {}) => {
    const start = Number(startedAt);
    const finish = Number(finishedAt);
    const budget = Number(budgetMs);

    if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) {
        throw new Error('Desktop startup timing requires a valid start and finish.');
    }
    if (!Number.isFinite(budget) || budget <= 0) {
        throw new Error('Desktop startup budget must be a positive number.');
    }

    const durationMs = Math.round(finish - start);
    return {
        budgetMs: Math.round(budget),
        durationMs,
        withinBudget: durationMs <= budget,
    };
};

const buildDesktopStartupUrl = (runtimeUrl, appVersion = '') => {
    const startupUrl = new URL(runtimeUrl);
    startupUrl.pathname = '/login';
    if (appVersion) {
        startupUrl.searchParams.set('desktopRuntimeVersion', String(appVersion));
    }
    return startupUrl.toString();
};

const loadWindowUrlSafely = async (window, url) => {
    if (!window || window.isDestroyed?.()) {
        return false;
    }

    try {
        await window.loadURL(url);
    } catch (error) {
        if (window.isDestroyed?.()) {
            return false;
        }
        throw error;
    }

    return !window.isDestroyed?.();
};

const revealWindow = (window, { focus = false, maximize = false } = {}) => {
    if (!window || window.isDestroyed?.()) {
        return false;
    }

    if (window.isMinimized?.()) {
        window.restore();
    }
    if (maximize) {
        window.maximize();
    }
    window.show();
    if (focus) {
        window.focus();
    }
    return true;
};

module.exports = {
    DEFAULT_DESKTOP_STARTUP_BUDGET_MS,
    buildDesktopStartupUrl,
    evaluateDesktopStartup,
    loadWindowUrlSafely,
    revealWindow,
    runWithTimeout,
};
