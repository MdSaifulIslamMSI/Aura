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
    revealWindow,
    runWithTimeout,
};
