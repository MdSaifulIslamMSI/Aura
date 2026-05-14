'use strict';

function buildOtpState(overrides = {}) {
    return {
        otpState: 'correct_otp',
        attempts: 0,
        leakedInResponse: false,
        ...overrides,
    };
}

module.exports = { buildOtpState };
