'use strict';

function createFakeOtpProvider() {
    const issued = new Map();
    return {
        issue(identity, code = '123456') {
            issued.set(identity, code);
            return { identity, code };
        },
        verify(identity, code) {
            return issued.get(identity) === code;
        },
    };
}

module.exports = { createFakeOtpProvider };
