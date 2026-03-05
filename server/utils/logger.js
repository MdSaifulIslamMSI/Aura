const os = require('os');

const formatMessage = (level, message, meta = {}) => {
    // Standardize error objects
    if (meta.error instanceof Error) {
        meta.error = {
            message: meta.error.message,
            stack: meta.error.stack,
            name: meta.error.name,
        };
    }

    return JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        hostname: os.hostname(),
        pid: process.pid,
        ...meta
    });
};

const logger = {
    info: (message, meta) => console.log(formatMessage('info', message, meta)),
    warn: (message, meta) => console.warn(formatMessage('warn', message, meta)),
    error: (message, meta) => console.error(formatMessage('error', message, meta)),
    debug: (message, meta) => {
        if (process.env.NODE_ENV !== 'production') {
            console.debug(formatMessage('debug', message, meta));
        }
    }
};

module.exports = logger;
