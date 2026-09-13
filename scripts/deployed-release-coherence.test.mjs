import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const verifierPath = fileURLToPath(new URL('../app/scripts/verify_deployed_release_coherence.mjs', import.meta.url));

const shellHtml = (assets) => `<!doctype html>
<meta name="aura-release-id" content="abc123">
<meta name="aura-release-commit" content="abc123">
<meta name="aura-release-target" content="multi-host">
<meta name="aura-release-channel" content="production">
<meta name="aura-release-built-at" content="2026-09-13T00:00:00Z">
${assets.map((src) => (src.endsWith('.css')
    ? `<link rel="stylesheet" href="${src}">`
    : `<link rel="modulepreload" href="${src}"><script type="module" src="${src}"></script>`)).join('\n')}
`;

const makeHost = (t, name, assets) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), `aura-coherence-${name}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'index.html'), shellHtml(Object.keys(assets)));
  const assetsDir = path.join(dir, 'assets');
  mkdirSync(assetsDir);
  for (const [src, content] of Object.entries(assets)) {
    writeFileSync(path.join(assetsDir, path.basename(src)), content);
  }
  return { dir, assetsDir };
};

const runVerifier = (targets, extraEnv = {}) => spawnSync(process.execPath, [verifierPath], {
  encoding: 'utf8',
  timeout: 30_000,
  env: {
    ...process.env,
    AURA_EXPECTED_RELEASE_ID: 'abc123',
    AURA_EXPECTED_COMMIT: 'abc123',
    AURA_EXPECTED_TARGET: 'multi-host',
    AURA_RELEASE_URLS: JSON.stringify(targets),
    ...extraEnv,
  },
});

test('coherence passes when all hosts serve byte-identical assets including CSS and chunks', (t) => {
  const assets = {
    '/assets/index-abc.js': 'console.log("entry")',
    '/assets/vendor-def.js': 'console.log("chunk")',
    '/assets/index-abc.css': 'body{}',
  };
  const hostA = makeHost(t, 'a', assets);
  const hostB = makeHost(t, 'b', assets);
  const result = runVerifier([
    { name: 'host-a', url: 'https://host-a.example', htmlPath: path.join(hostA.dir, 'index.html'), assetsDir: hostA.assetsDir },
    { name: 'host-b', url: 'https://host-b.example', htmlPath: path.join(hostB.dir, 'index.html'), assetsDir: hostB.assetsDir },
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.coherent, true);
  assert.equal(verdict.release.verifiedAssetCount, 3);
  assert.deepEqual(verdict.hosts.map((h) => h.assetCount), [3, 3]);
});

test('coherence fails naming the lazy chunk whose bytes diverge', (t) => {
  const hostA = makeHost(t, 'a', {
    '/assets/index-abc.js': 'console.log("entry")',
    '/assets/vendor-def.js': 'console.log("chunk v1")',
  });
  const hostB = makeHost(t, 'b', {
    '/assets/index-abc.js': 'console.log("entry")',
    '/assets/vendor-def.js': 'console.log("chunk v2")',
  });
  const result = runVerifier([
    { name: 'host-a', url: 'https://host-a.example', htmlPath: path.join(hostA.dir, 'index.html'), assetsDir: hostA.assetsDir },
    { name: 'host-b', url: 'https://host-b.example', htmlPath: path.join(hostB.dir, 'index.html'), assetsDir: hostB.assetsDir },
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /vendor-def\.js/);
  assert.match(result.stderr, /bytes differ/);
});

test('coherence fails when a host references a different asset set', (t) => {
  const hostA = makeHost(t, 'a', { '/assets/index-abc.js': 'entry' });
  const hostB = makeHost(t, 'b', { '/assets/index-xyz.js': 'entry' });
  const result = runVerifier([
    { name: 'host-a', url: 'https://host-a.example', htmlPath: path.join(hostA.dir, 'index.html'), assetsDir: hostA.assetsDir },
    { name: 'host-b', url: 'https://host-b.example', htmlPath: path.join(hostB.dir, 'index.html'), assetsDir: hostB.assetsDir },
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing from HTML|referenced only by this host/);
});

test('coherence fails when builtAt skews beyond the configured budget', (t) => {
  const assets = { '/assets/index-abc.js': 'entry' };
  const hostA = makeHost(t, 'a', assets);
  const hostB = makeHost(t, 'b', assets);
  writeFileSync(path.join(hostB.dir, 'index.html'),
    shellHtml(Object.keys(assets)).replace('2026-09-13T00:00:00Z', '2026-09-13T00:10:00Z'));
  const result = runVerifier([
    { name: 'host-a', url: 'https://host-a.example', htmlPath: path.join(hostA.dir, 'index.html'), assetsDir: hostA.assetsDir },
    { name: 'host-b', url: 'https://host-b.example', htmlPath: path.join(hostB.dir, 'index.html'), assetsDir: hostB.assetsDir },
  ], { AURA_RELEASE_BUILT_AT_MAX_SKEW_SECONDS: '60' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /builtAt.*exceeding 60s/);
});
