module.exports = {
    testEnvironment: 'node',
    verbose: true,
    maxWorkers: '50%',
    workerIdleMemoryLimit: process.env.JEST_WORKER_IDLE_MEMORY_LIMIT || '512MB',
    // svix v2 is ESM-only; compile just its entry to CJS for the CommonJS Jest
    // runtime. All other node_modules keep default (untransformed) resolution.
    transform: {
        '^.+\\.[cm]?js$': ['babel-jest', { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }],
    },
    transformIgnorePatterns: ['node_modules/(?!(svix)/)'],
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
