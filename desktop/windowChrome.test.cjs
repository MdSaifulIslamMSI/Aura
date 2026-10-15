const assert = require('node:assert/strict');
const test = require('node:test');

const {
    MAIN_WINDOW_ZOOM,
    buildAuthWindowOptions,
    buildAuthWindowWebPreferences,
    buildMainWindowWebPreferences,
    getInitialWindowBounds,
} = require('./windowChrome.cjs');

test('initial window bounds stay usable across display sizes', () => {
    // A 4K display must not open a 4K-wide window.
    assert.deepEqual(getInitialWindowBounds({ width: 3840, height: 2160 }), {
        width: 1680,
        height: 1040,
    });

    // A small netbook screen still gets something above the enforced minimums.
    // 768 is already above the 760 floor, so only the width is clamped up.
    assert.deepEqual(getInitialWindowBounds({ width: 1024, height: 768 }), {
        width: 1180,
        height: 768,
    });

    // Below the floor on both axes, both clamp up to the minimum.
    assert.deepEqual(getInitialWindowBounds({ width: 800, height: 600 }), {
        width: 1180,
        height: 760,
    });

    assert.deepEqual(getInitialWindowBounds({ width: 1440, height: 900 }), {
        width: 1440,
        height: 900,
    });

    // Missing or unparsable display metrics must not produce NaN bounds, which
    // Electron rejects outright.
    assert.deepEqual(getInitialWindowBounds({}), { width: 1180, height: 760 });
    assert.deepEqual(getInitialWindowBounds(), { width: 1180, height: 760 });
    assert.deepEqual(getInitialWindowBounds({ width: 'x', height: null }), {
        width: 1180,
        height: 760,
    });
});

test('the main renderer runs sandboxed with no Node access', () => {
    const preferences = buildMainWindowWebPreferences({
        preloadPath: '/app/desktop/preload.cjs',
    });

    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.preload, '/app/desktop/preload.cjs');
    assert.equal(
        preferences.backgroundThrottling,
        false,
        'the renderer must keep ticking while hidden, or IPC-dependent UI stalls'
    );
});

test('auth popups inherit the parent session but stay sandboxed', () => {
    const parentWindow = { webContents: { session: { id: 'shared-session' } } };
    const preferences = buildAuthWindowWebPreferences(parentWindow);

    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.sandbox, true);
    assert.equal(
        preferences.session.id,
        'shared-session',
        'the popup must reuse the parent session or the OAuth flow loses its cookies'
    );

    // A missing parent must not throw while a window is being torn down.
    const orphan = buildAuthWindowWebPreferences(undefined);
    assert.equal(orphan.sandbox, true);
    assert.equal(orphan.session, undefined);
});

test('auth popup geometry and modality are unchanged by the extraction', () => {
    const parentWindow = { webContents: { session: { id: 's' } } };
    const options = buildAuthWindowOptions(parentWindow);

    assert.equal(options.parent, parentWindow);
    assert.equal(options.modal, false, 'a modal would block the main window during OAuth');
    assert.equal(options.width, 640);
    assert.equal(options.height, 780);
    assert.equal(options.minWidth, 520);
    assert.equal(options.minHeight, 560);
    assert.equal(options.show, true);
    assert.equal(options.autoHideMenuBar, true);
    assert.deepEqual(options.webPreferences, buildAuthWindowWebPreferences(parentWindow));
});

test('the app pins its own zoom level', () => {
    assert.equal(MAIN_WINDOW_ZOOM, 1);
});