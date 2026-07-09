import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertDesktopVersionFloor,
  compareVersions,
  extractDesktopVersions,
  highestVersion,
  parseVersion,
} from './assert-desktop-version-floor.mjs';

test('desktop release floor extracts stable desktop tags from remote refs', () => {
  assert.deepEqual(
    extractDesktopVersions([
      '5461d34c507860e88c9c025364eac65af577a33a\trefs/tags/desktop-v1.0.146',
      '55b444edb6f6f621cd0cf8cfa6b6b2954ed64caf\trefs/tags/desktop-v1.0.98',
      'abcdef\trefs/tags/mobile-v1.0.200',
      'abcdef\trefs/tags/desktop-v1.0.147-beta.1',
    ].join('\n')),
    ['1.0.146', '1.0.98']
  );
});

test('desktop release floor compares numeric semver patches, not timestamps or strings', () => {
  assert.equal(compareVersions(parseVersion('1.0.146'), parseVersion('1.0.98')) > 0, true);
  assert.equal(highestVersion(['1.0.98', '1.0.146', '1.0.99'])?.raw, '1.0.146');
});

test('desktop release floor rejects versions that cannot update installed higher builds', () => {
  assert.throws(
    () => assertDesktopVersionFloor({
      requested: '1.0.98',
      existingVersions: ['1.0.146', '1.0.97'],
    }),
    /must be greater than existing desktop release 1\.0\.146/
  );
});

test('desktop release floor allows the next version above the existing highest desktop tag', () => {
  assert.deepEqual(
    assertDesktopVersionFloor({
      requested: '1.0.147',
      existingVersions: ['1.0.146', '1.0.98'],
    }),
    {
      requested: '1.0.147',
      highestExisting: '1.0.146',
    }
  );
});
