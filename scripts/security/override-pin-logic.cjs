// Pure logic for the override-pin gate, kept in CommonJS so that both the
// ESM gate script and the CommonJS jest suite can load it without a module
// interop flag. The gate itself lives in scripts/security/check-override-pins.mjs.

const fs = require('fs');
const path = require('path');

const MANIFESTS = [
  'package.json',
  'app/package.json',
  'server/package.json',
  'packages/supply-chain-gates/package.json',
  'packages/route-security-matrix/package.json',
];

/**
 * True when an override value is an EXACT version pin.
 *
 * A range pin (`^1.2.3`) still admits a patched release, so it cannot revert
 * a security fix. An exact pin does: npm forces it across the whole tree, so
 * a Dependabot bump is silently reverted on the next install.
 */
const isExactPin = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return false;
  if (raw.startsWith('file:') || raw.startsWith('npm:') || raw.startsWith('git')) return false;
  return !/[\^~><*|\s]/.test(raw);
};

const compareVersions = (left, right) => {
  const parse = (value) => String(value || '')
    .split(/[.-]/)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
};

const collectExactPins = (repoRoot, manifests = MANIFESTS) => {
  const pins = [];
  for (const manifestPath of manifests) {
    const absolute = path.join(repoRoot, manifestPath);
    if (!fs.existsSync(absolute)) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    } catch (error) {
      throw new Error(`${manifestPath} is not valid JSON: ${error.message}`);
    }
    for (const [name, value] of Object.entries(manifest.overrides || {})) {
      if (typeof value === 'string' && isExactPin(value)) {
        pins.push({ manifest: manifestPath, name, version: value.trim() });
      }
    }
  }
  return pins;
};

module.exports = {
  MANIFESTS,
  isExactPin,
  compareVersions,
  collectExactPins,
};
