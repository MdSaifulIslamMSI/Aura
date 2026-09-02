module.exports = {
    testEnvironment: 'node',
    verbose: true,
    maxWorkers: '50%',
    workerIdleMemoryLimit: process.env.JEST_WORKER_IDLE_MEMORY_LIMIT || '512MB',
    // svix v2 and jose (pulled in by firebase-admin's auth submodule via
    // jwks-rsa) are ESM-only; compile just their files to CJS for the CommonJS
    // Jest runtime. The pattern is deliberately scoped to those packages so
    // project files stay untransformed (preset-env would inject 'use strict'
    // into every module and turn silent sloppy-mode no-ops into TypeErrors,
    // e.g. req.query writes in middleware/validate.js).
    transform: {
        'node_modules[/\\\\](svix|jose)[/\\\\].+\\.[cm]?js$': ['babel-jest', { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }],
    },
    transformIgnorePatterns: ['node_modules/(?!(svix|jose)/)'],
    setupFilesAfterEnv: ['./tests/setup.js'],
    testMatch: ['**/*.test.js'],
    coverageProvider: 'v8',
    collectCoverageFrom: [
        'controllers/**/*.js',
        'services/**/*.js',
        'middleware/**/*.js',
        'models/**/*.js',
        'config/**/*.js',
        'utils/**/*.js',
        '!**/node_modules/**',
    ],
    coverageThreshold: {
        global: {
            branches: 47,
            functions: 26,
            lines: 34,
            statements: 34,
        },
    },
};
