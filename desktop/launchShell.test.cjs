const assert = require('node:assert/strict');
const test = require('node:test');

const {
    buildLaunchShellDataUrl,
    buildLaunchShellHtml,
    normalizeIconDataUrl,
} = require('./launchShell.cjs');

test('desktop launch shell is self-contained, accessible, and dark', () => {
    const html = buildLaunchShellHtml({ iconDataUrl: 'data:image/png;base64,AAAA' });

    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /default-src 'none'/);
    assert.match(html, /Aura Desktop is starting/);
    assert.match(html, /background:#202020/);
    assert.match(html, /data:image\/png;base64,AAAA/);
    assert.doesNotMatch(html, /https?:\/\//);
});

test('desktop launch shell rejects untrusted image sources', () => {
    assert.equal(normalizeIconDataUrl('https://example.com/icon.png'), '');
    assert.equal(normalizeIconDataUrl('data:text/html;base64,AAAA'), '');

    const html = buildLaunchShellHtml({ iconDataUrl: 'javascript:alert(1)' });
    assert.doesNotMatch(html, /javascript:/);
    assert.match(html, /<span aria-hidden="true">A<\/span>/);
});

test('desktop launch shell produces an encoded data URL', () => {
    const dataUrl = buildLaunchShellDataUrl();
    assert.match(dataUrl, /^data:text\/html;charset=utf-8,/);
    assert.match(decodeURIComponent(dataUrl.split(',').slice(1).join(',')), /<title>Aura Desktop<\/title>/);
});
