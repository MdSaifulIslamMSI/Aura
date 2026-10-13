const assert = require('node:assert/strict');
const test = require('node:test');

const {
    UPDATE_CHECK_DELAY_MS,
    UPDATE_CHECK_INTERVAL_MS,
    UPDATE_FOCUS_THROTTLE_MS,
    buildUpdateErrorMessage,
    buildUpdateRestartPrompt,
    buildUpdateStatusPayload,
    shouldCheckForUpdatesOnFocus,
    shouldInstallUpdateNow,
    shouldPromptForRestart,
    shouldStartAutoUpdateChecks,
} = require('./autoUpdatePolicy.cjs');

test('auto-update checks only run for packaged builds that have not opted out', () => {
    assert.equal(shouldStartAutoUpdateChecks({ isPackaged: true }), true);
    assert.equal(
        shouldStartAutoUpdateChecks({ isPackaged: false }),
        false,
        'an unpackaged tree has no signed feed to compare against'
    );
    assert.equal(
        shouldStartAutoUpdateChecks({ isPackaged: true, autoUpdateDisabled: true }),
        false
    );
    assert.equal(
        shouldStartAutoUpdateChecks({ isPackaged: true, alreadyStarted: true }),
        false,
        'repeat starts must not stack a second set of listeners and timers'
    );
    assert.equal(shouldStartAutoUpdateChecks(), false);
});

test('focus-triggered update checks stay throttled', () => {
    const now = 1_000_000_000;
    assert.equal(shouldCheckForUpdatesOnFocus({ lastCheckAt: now, now }), false);
    assert.equal(
        shouldCheckForUpdatesOnFocus({
            lastCheckAt: now - UPDATE_FOCUS_THROTTLE_MS - 1,
            now,
        }),
        true
    );
    assert.equal(
        shouldCheckForUpdatesOnFocus({
            lastCheckAt: now - UPDATE_FOCUS_THROTTLE_MS,
            now,
        }),
        false,
        'the boundary itself must not trigger a check'
    );
    // No prior check is treated as long past the throttle, so the first focus
    // after a fresh launch can check.
    assert.equal(shouldCheckForUpdatesOnFocus({ lastCheckAt: 0, now }), true);
});

test('unresolvable update channels become an actionable message', () => {
    const expected = 'Aura could not resolve the GitHub update channel. Check your internet or DNS, then try again.';
    assert.equal(buildUpdateErrorMessage(new Error('getaddrinfo ENOTFOUND github.com')), expected);
    assert.equal(buildUpdateErrorMessage(new Error('ERR_NAME_NOT_RESOLVED')), expected);
    assert.equal(
        buildUpdateErrorMessage('net::ERR_NAME_NOT_RESOLVED'),
        expected,
        'a bare string error must be classified too'
    );
    assert.equal(
        buildUpdateErrorMessage(new Error('disk full')),
        'disk full',
        'unrelated failures keep their original message'
    );
    assert.equal(buildUpdateErrorMessage(new Error('   ')), 'Update check failed.');
    assert.equal(buildUpdateErrorMessage(), 'Update check failed.');
});

test('the restart prompt is shown once per download', () => {
    assert.equal(shouldPromptForRestart({ promptAlreadyShown: false }), true);
    assert.equal(shouldPromptForRestart({ promptAlreadyShown: true }), false);
    assert.equal(shouldPromptForRestart(), true);

    const prompt = buildUpdateRestartPrompt();
    assert.equal(prompt.type, 'info');
    assert.equal(prompt.defaultId, 0);
    assert.equal(prompt.cancelId, 1);
    assert.deepEqual(prompt.buttons, ['Restart and update', 'Later']);
});

test('only the default button installs the update', () => {
    assert.equal(shouldInstallUpdateNow({ response: 0 }), true);
    // Response 1 is "Later", which must leave the app running and install on quit.
    assert.equal(shouldInstallUpdateNow({ response: 1 }), false);
    assert.equal(shouldInstallUpdateNow({}), false);
});

test('update status payloads keep a stable renderer shape', () => {
    assert.deepEqual(buildUpdateStatusPayload('checking'), { type: 'checking' });

    assert.deepEqual(
        buildUpdateStatusPayload('available', { version: '1.2.3' }),
        { type: 'available', version: '1.2.3' }
    );
    // A missing version still arrives as a string, so the renderer never has to
    // branch on the payload shape.
    assert.deepEqual(
        buildUpdateStatusPayload('downloaded'),
        { type: 'downloaded', version: '' }
    );
    assert.deepEqual(
        buildUpdateStatusPayload('downloading', { percent: '42' }),
        { type: 'downloading', percent: 42 }
    );
    assert.deepEqual(
        buildUpdateStatusPayload('downloading', {}),
        { type: 'downloading', percent: 0 }
    );
    assert.deepEqual(
        buildUpdateStatusPayload('error', { message: 'nope' }),
        { type: 'error', message: 'nope' }
    );
});

test('update check timing stays conservative', () => {
    assert.ok(UPDATE_CHECK_DELAY_MS > 0, 'startup check must be deferred');
    assert.ok(
        UPDATE_CHECK_INTERVAL_MS >= UPDATE_FOCUS_THROTTLE_MS,
        'the periodic interval must not fire more often than the focus throttle'
    );
});