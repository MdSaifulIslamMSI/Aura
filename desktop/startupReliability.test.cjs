const assert = require('node:assert/strict');
const test = require('node:test');

const { revealWindow, runWithTimeout } = require('./startupReliability.cjs');

test('desktop startup timeout does not wait forever for a blocked task', async () => {
    await assert.rejects(
        runWithTimeout(new Promise(() => {}), 20, 'cache cleanup timed out'),
        (error) => error.code === 'ETIMEDOUT' && /cache cleanup timed out/.test(error.message)
    );
});

test('desktop startup timeout returns a completed task result', async () => {
    assert.equal(await runWithTimeout(Promise.resolve('ready'), 100), 'ready');
});

test('desktop window recovery restores, reveals, and focuses the window', () => {
    const calls = [];
    const window = {
        isDestroyed: () => false,
        isMinimized: () => true,
        restore: () => calls.push('restore'),
        maximize: () => calls.push('maximize'),
        show: () => calls.push('show'),
        focus: () => calls.push('focus'),
    };

    assert.equal(revealWindow(window, { focus: true, maximize: true }), true);
    assert.deepEqual(calls, ['restore', 'maximize', 'show', 'focus']);
    assert.equal(revealWindow({ isDestroyed: () => true }), false);
});
