/**
 * Pure-unit jest config: runs tests that have no MongoDB/Redis dependency
 * without the global tests/setup.js bootstrap (which requires a live
 * database). Usage:
 *
 *   node node_modules/jest/bin/jest.js --config jest.unit.config.js
 *
 * Intentionally NOT wired into `npm test` — the default config remains the
 * repository contract.
 */
module.exports = {
    rootDir: '.',
    testEnvironment: 'node',
    testMatch: [
        '**/tests/promptGuardService.test.js',
        '**/tests/openFgaService.test.js',
    ],
};
