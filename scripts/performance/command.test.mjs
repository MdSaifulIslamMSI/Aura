import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeWindowsToken } from './command.mjs';

test('performance Windows command tokens allow the fixed tool arguments', () => {
  assert.equal(assertSafeWindowsToken('--config=./lighthouserc.js'), '--config=./lighthouserc.js');
  assert.equal(assertSafeWindowsToken('@lhci/cli'), '@lhci/cli');
});

test('performance Windows command tokens reject shell metacharacters', () => {
  assert.throws(() => assertSafeWindowsToken('load & whoami'), /Unsafe Windows command token/);
  assert.throws(() => assertSafeWindowsToken('%PATH%'), /Unsafe Windows command token/);
});
