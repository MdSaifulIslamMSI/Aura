'use strict';

function buildSessionState(overrides = {}) {
    return {
        sessionState: 'active_session',
        deviceState: 'known_device',
        csrf: 'valid',
        ...overrides,
    };
}

module.exports = { buildSessionState };
