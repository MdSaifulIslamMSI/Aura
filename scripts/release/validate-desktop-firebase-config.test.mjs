import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveDesktopFirebaseConfig,
  validateDesktopFirebaseConfig,
} from './validate-desktop-firebase-config.mjs';

test('desktop Firebase validation fails closed when auth configuration is absent', () => {
  assert.deepEqual(validateDesktopFirebaseConfig({}), {
    valid: false,
    missing: ['apiKey', 'authDomain', 'projectId', 'appId'],
  });
});

test('desktop Firebase validation accepts the direct release variables', () => {
  const result = validateDesktopFirebaseConfig({
    VITE_FIREBASE_API_KEY: 'api-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'example.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'example',
    VITE_FIREBASE_APP_ID: 'app-id',
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.missing, []);
});

test('desktop Firebase validation matches aggregate config and auth-domain derivation', () => {
  const config = resolveDesktopFirebaseConfig({
    VITE_FIREBASE_CONFIG: JSON.stringify({
      apiKey: 'aggregate-key',
      projectId: 'aggregate-project',
      appId: 'aggregate-app',
    }),
  });

  assert.deepEqual(config, {
    apiKey: 'aggregate-key',
    authDomain: 'aggregate-project.firebaseapp.com',
    projectId: 'aggregate-project',
    appId: 'aggregate-app',
  });
});
