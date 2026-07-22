const assert = require('node:assert/strict');
const test = require('node:test');

const {
    DEFAULT_DESKTOP_STARTUP_BUDGET_MS,
    buildDesktopStartupUrl,
    evaluateDesktopStartup,
    loadWindowUrlSafely,
    revealWindow,
    runWithTimeout,
} = require('./startupReliability.cjs');

test('desktop startup telemetry classifies the end-to-end startup budget', () => {
    assert.deepEqual(
        evaluateDesktopStartup({ startedAt: 100, finishedAt: 2500 }),
        {
            budgetMs: DEFAULT_DESKTOP_STARTUP_BUDGET_MS,
            durationMs: 2400,
            withinBudget: true,
        }
    );
    assert.equal(
        evaluateDesktopStartup({ startedAt: 100, finishedAt: 3201 }).withinBudget,
        false
    );
});

test('desktop startup enters the local sign-in route without changing the runtime origin', () => {
    assert.equal(
        buildDesktopStartupUrl('http://localhost:47831/', '1.0.176'),
        'http://localhost:47831/login?desktopRuntimeVersion=1.0.176'
    );
    assert.equal(
        buildDesktopStartupUrl('http://localhost:47839/base?keep=1'),
        'http://localhost:47839/login?keep=1'
    );
});

test('desktop startup timeout does not wait forever for a blocked task', async () => {
    await assert.rejects(
        runWithTimeout(new Promise(() => {}), 20, 'cache cleanup timed out'),
        (error) => error.code === 'ETIMEDOUT' && /cache cleanup timed out/.test(error.message)
    );
});

test('desktop startup timeout returns a completed task result', async () => {
    assert.equal(await runWithTimeout(Promise.resolve('ready'), 100), 'ready');
});

test('desktop window navigation tolerates a window closing before or during load', async () => {
    const closedWindow = {
        isDestroyed: () => true,
        loadURL: () => assert.fail('a destroyed window must not navigate'),
    };
    assert.equal(await loadWindowUrlSafely(closedWindow, 'data:text/plain,closed'), false);

    let destroyed = false;
    const closingWindow = {
        isDestroyed: () => destroyed,
        loadURL: async () => {
            destroyed = true;
            throw new Error('ERR_ABORTED');
        },
    };
    assert.equal(await loadWindowUrlSafely(closingWindow, 'data:text/plain,closing'), false);
});

test('desktop window navigation preserves real load failures', async () => {
    const window = {
        isDestroyed: () => false,
        loadURL: async () => {
            throw new Error('network failed');
        },
    };

    await assert.rejects(
        loadWindowUrlSafely(window, 'https://example.invalid'),
        /network failed/
    );
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
