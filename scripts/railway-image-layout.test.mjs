import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Guards the Railway storefront image layout. Regression origin: the Railway
// service was first configured with Root Directory `app`, which is the Docker
// build context, so the Vite build could not resolve the two repo-root inputs
// its import graph reaches (`../../config/desktopAuthLoopback.cjs` and
// `../../../shared/assistantCapabilities.json`) and the deploy failed with
// [UNRESOLVED_IMPORT].
const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dockerfilePath = path.join(repoRoot, 'app', 'Dockerfile.railway');
const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');

const copyInstructions = dockerfile
  .split(/\r?\n/)
  .filter((line) => line.startsWith('COPY ') && !line.includes('--from='))
  .map((line) => line.replace(/^COPY\s+/, '').trim().split(/\s+/).slice(0, -1));

test('every Railway Dockerfile COPY source exists in the repo-root context', () => {
  assert.ok(copyInstructions.length >= 4, 'expected the build-stage COPY instructions');
  for (const source of copyInstructions.flat()) {
    const cleaned = source.replace(/^\.\//, '');
    assert.ok(
      fs.existsSync(path.join(repoRoot, cleaned)),
      `COPY source missing from the repo-root build context: ${cleaned}`
    );
  }
  assert.ok(
    copyInstructions.flat().includes('app/'),
    'the storefront sources must be copied in from app/'
  );
});

test('the repo-root inputs resolve in the simulated image layout', () => {
  const image = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-railway-image-'));
  try {
    fs.cpSync(path.join(repoRoot, 'app'), path.join(image, 'app'), {
      recursive: true,
      filter: (source) => !/(node_modules|dist|android|ios)$/.test(source),
    });
    for (const [from, to] of [
      ['config/desktopAuthLoopback.cjs', path.join('config', 'desktopAuthLoopback.cjs')],
      ['shared/assistantCapabilities.json', path.join('shared', 'assistantCapabilities.json')],
    ]) {
      fs.mkdirSync(path.dirname(path.join(image, to)), { recursive: true });
      fs.copyFileSync(path.join(repoRoot, from), path.join(image, to));
    }

    for (const [file, specifier, expected] of [
      ['config/vercelRoutingContract.mjs', '../../config/desktopAuthLoopback.cjs', 'config/desktopAuthLoopback.cjs'],
      ['src/utils/assistantCommands.js', '../../../shared/assistantCapabilities.json', 'shared/assistantCapabilities.json'],
    ]) {
      const resolved = path.resolve(path.dirname(path.join(image, 'app', file)), specifier);
      assert.equal(
        path.normalize(resolved),
        path.normalize(path.join(image, expected)),
        `${file} -> ${specifier} must resolve to ${expected} inside the image`
      );
      assert.ok(fs.existsSync(resolved), `${file} -> ${specifier} is missing from the image layout`);
    }

    const require = createRequire(path.join(image, 'app', 'package.json'));
    const contractPath = path.join(image, 'app', 'config', 'vercelRoutingContract.mjs');
    const contract = require(contractPath);
    assert.ok(
      typeof contract.buildRailwayCaddyfile === 'function',
      'vercelRoutingContract must load with the desktopAuthLoopback import resolved'
    );
  } finally {
    fs.rmSync(image, { recursive: true, force: true });
  }
});

test('railway.toml points at the repo-root Dockerfile and keeps secrets ignored', () => {
  const railwayToml = fs.readFileSync(path.join(repoRoot, 'app', 'railway.toml'), 'utf8');
  assert.match(railwayToml, /dockerfilePath = "app\/Dockerfile\.railway"/);
  assert.match(railwayToml, /healthcheckPath = "\/"/);

  const lines = fs.readFileSync(path.join(repoRoot, '.dockerignore'), 'utf8').split(/\r?\n/);
  assert.ok(
    !lines.some((line) => line.trim() === 'app'),
    '.dockerignore must not blanket-exclude app/ — the Railway context cannot see the storefront'
  );
  for (const required of ['**/.env', '**/.env.*', '.student-pack.local.env']) {
    assert.ok(lines.some((line) => line.trim() === required), `.dockerignore lost secret rule ${required}`);
  }
});
