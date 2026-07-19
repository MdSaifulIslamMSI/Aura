const test = require('node:test');
const assert = require('node:assert/strict');
const {
    canGrantDesktopRuntimePermission,
    isAuthWindowUrl,
    isInternalUrl,
    isSafeExternalUrl,
    isTrustedDesktopIpcSender,
} = require('./securityPolicy.cjs');

const runtimeUrl = 'http://127.0.0.1:47831';

test('internal URLs require the active loopback origin and port', () => {
    assert.equal(isInternalUrl('http://localhost:47831/login', runtimeUrl), true);
    assert.equal(isInternalUrl('http://127.0.0.1:47832/login', runtimeUrl), false);
    assert.equal(isInternalUrl('https://aurapilot.vercel.app/login', runtimeUrl), false);
});

test('auth popups only trust exact provider and project-owned hosts', () => {
    assert.equal(isAuthWindowUrl('https://billy-b674c.firebaseapp.com/__/auth/handler'), true);
    assert.equal(isAuthWindowUrl('https://accounts.google.com/o/oauth2/auth'), true);
    assert.equal(isAuthWindowUrl('https://evil.web.app/__/auth/handler'), false);
    assert.equal(isAuthWindowUrl('https://attacker.firebaseapp.com/__/auth/handler'), false);
    assert.equal(isAuthWindowUrl('https://login.google.com.example.test/'), false);
});

test('external launching rejects local files and arbitrary OS schemes', () => {
    assert.equal(isSafeExternalUrl('https://example.com/help'), true);
    assert.equal(isSafeExternalUrl('mailto:support@example.com'), true);
    assert.equal(isSafeExternalUrl('tel:+12025550123'), true);
    assert.equal(isSafeExternalUrl('file:///C:/Windows/System32/calc.exe'), false);
    assert.equal(isSafeExternalUrl('ms-settings:privacy'), false);
});

test('runtime permissions require the exact active runtime origin', () => {
    assert.equal(canGrantDesktopRuntimePermission('media', `${runtimeUrl}/call`, runtimeUrl), true);
    assert.equal(canGrantDesktopRuntimePermission('videoCapture', 'http://localhost:47831/call', runtimeUrl), true);
    assert.equal(canGrantDesktopRuntimePermission('media', 'http://127.0.0.1:47832/call', runtimeUrl), false);
    assert.equal(canGrantDesktopRuntimePermission('media', 'https://aurapilot.vercel.app/call', runtimeUrl), false);
    assert.equal(canGrantDesktopRuntimePermission('geolocation', `${runtimeUrl}/`, runtimeUrl), false);
});

test('IPC sender must be the internal main frame of the main window', () => {
    const mainFrame = { url: `${runtimeUrl}/login` };
    const webContents = { mainFrame, getURL: () => mainFrame.url };
    const mainWindow = { webContents };

    assert.equal(isTrustedDesktopIpcSender({
        event: { sender: webContents, senderFrame: mainFrame },
        mainWindow,
        runtimeUrl,
    }), true);
    assert.equal(isTrustedDesktopIpcSender({
        event: { sender: webContents, senderFrame: { url: 'https://evil.example/' } },
        mainWindow,
        runtimeUrl,
    }), false);
    assert.equal(isTrustedDesktopIpcSender({
        event: { sender: { getURL: () => `${runtimeUrl}/` }, senderFrame: mainFrame },
        mainWindow,
        runtimeUrl,
    }), false);
});
