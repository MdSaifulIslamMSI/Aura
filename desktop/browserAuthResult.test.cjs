const assert = require('node:assert/strict');
const test = require('node:test');
const {
    DESKTOP_BROWSER_SIGN_IN_CANCELLED_CODE,
    formatDesktopAuthResultForRenderer,
} = require('./browserAuthResult.cjs');

test('desktop auth renderer results distinguish pending, completed, and cancelled states', () => {
    assert.deepEqual(formatDesktopAuthResultForRenderer(), {
        success: false,
        message: 'Desktop browser sign-in is not ready or has expired.',
    });

    assert.deepEqual(formatDesktopAuthResultForRenderer({
        requestId: 'request-complete',
        customToken: 'custom-token',
        completedAt: 101,
    }), {
        success: true,
        requestId: 'request-complete',
        customToken: 'custom-token',
        completedAt: 101,
    });

    assert.deepEqual(formatDesktopAuthResultForRenderer({
        requestId: 'request-cancelled',
        cancelled: true,
        cancelledAt: 202,
    }), {
        success: false,
        cancelled: true,
        code: DESKTOP_BROWSER_SIGN_IN_CANCELLED_CODE,
        requestId: 'request-cancelled',
        cancelledAt: 202,
        message: 'Desktop browser sign-in was cancelled.',
    });
});
