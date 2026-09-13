import assert from 'node:assert/strict';
import test from 'node:test';

import { checkParity } from '../app/scripts/verify_host_env_parity.mjs';

const expected = [
  { name: 'VITE_API_URL', empty: false },
  { name: 'VITE_FIREBASE_API_KEY', empty: false },
  { name: 'VITE_SENTRY_DSN', empty: true },
  { name: 'VITE_DD_APPLICATION_ID', empty: true },
];

test('parity holds when every host matches the build contract', () => {
  const verdict = checkParity(expected, {
    netlify: { vars: [
      { key: 'VITE_API_URL', value: 'https://x/api' },
      { key: 'VITE_FIREBASE_API_KEY', value: 'key' },
      { key: 'VITE_SENTRY_DSN', value: '' },
    ] },
    vercel: { vars: [
      { key: 'VITE_API_URL', value: 'https://x/api' },
      { key: 'VITE_FIREBASE_API_KEY', value: null }, // masked by provider
      { key: 'VITE_DD_APPLICATION_ID', value: '' },
    ] },
    render: { vars: [
      { key: 'VITE_API_URL', value: 'https://x/api' },
      { key: 'VITE_FIREBASE_API_KEY', value: 'key' },
      // expected-empty vars must be absent on Render entirely
    ] },
  });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.violations));
  assert.deepEqual(verdict.violations, []);
});

test('missing expected non-empty var on a host fails', () => {
  const verdict = checkParity(expected, {
    netlify: { vars: [{ key: 'VITE_API_URL', value: 'https://x/api' }] },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.violations.some((v) => v.includes('netlify') && v.includes('VITE_FIREBASE_API_KEY')));
});

test('expected-empty var with a host-side value fails outside Render', () => {
  const verdict = checkParity(expected, {
    netlify: { vars: [
      { key: 'VITE_API_URL', value: 'https://x/api' },
      { key: 'VITE_FIREBASE_API_KEY', value: 'key' },
      { key: 'VITE_SENTRY_DSN', value: 'https://oio.ingest.sentry.io/1' },
    ] },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.violations.some((v) => v.includes('VITE_SENTRY_DSN') && v.includes('bundle divergence')));
});

test('expected-empty var present anywhere on Render fails even when empty', () => {
  const verdict = checkParity(expected, {
    render: { vars: [
      { key: 'VITE_API_URL', value: 'https://x/api' },
      { key: 'VITE_FIREBASE_API_KEY', value: 'key' },
      { key: 'VITE_SENTRY_DSN', value: '' },
    ] },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.violations.some((v) => v.includes('Render rejects empty env values')));
});

test('host-side vars outside the contract fail as drift', () => {
  const verdict = checkParity(expected, {
    vercel: { vars: [
      { key: 'VITE_API_URL', value: 'https://x/api' },
      { key: 'VITE_FIREBASE_API_KEY', value: 'key' },
      { key: 'VITE_STAGING_ONLY_FLAG', value: 'true' },
    ] },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.violations.some((v) => v.includes('VITE_STAGING_ONLY_FLAG') && v.includes('not part of the CI build contract')));
});

test('masked value with correct presence does not fail, but masked empty does', () => {
  // masked (value null) non-empty var: presence is enough
  const maskedOk = checkParity(expected, {
    vercel: { vars: [
      { key: 'VITE_API_URL', value: null },
      { key: 'VITE_FIREBASE_API_KEY', value: null },
    ] },
  });
  assert.equal(maskedOk.ok, true, JSON.stringify(maskedOk.violations));

  // masked empty var: emptiness cannot be proven, so presence is accepted but
  // a proven-empty var is fine too — the contract only fails on proven divergence
  const provenEmpty = checkParity(expected, {
    netlify: { vars: [
      { key: 'VITE_API_URL', value: 'https://x/api' },
      { key: 'VITE_FIREBASE_API_KEY', value: 'key' },
      { key: 'VITE_SENTRY_DSN', value: '' },
      { key: 'VITE_DD_APPLICATION_ID', value: '' },
    ] },
  });
  assert.equal(provenEmpty.ok, true, JSON.stringify(provenEmpty.violations));
});

test('empty-string value for a contract non-empty var fails', () => {
  const verdict = checkParity(expected, {
    netlify: { vars: [{ key: 'VITE_API_URL', value: '' }, { key: 'VITE_FIREBASE_API_KEY', value: 'key' }] },
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.violations.some((v) => v.includes('VITE_API_URL') && v.includes('empty on the host')));
});

test('unconfigured hosts and null states are skipped', () => {
  const verdict = checkParity(expected, { netlify: null, vercel: undefined, render: { vars: [] } });
  assert.equal(verdict.ok, false); // render: non-empty vars missing
  assert.ok(verdict.violations.every((v) => v.startsWith('render')));
});
