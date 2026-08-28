module.exports = {
    testEnvironment: 'node',
    verbose: true,
    maxWorkers: '50%',
    testTimeout: 30000,
    workerIdleMemoryLimit: process.env.JEST_WORKER_IDLE_MEMORY_LIMIT || '512MB',
    setupFilesAfterEnv: ['./tests/setup.js'],
    testMatch: ['**/*.test.js'],
    coverageProvider: 'v8',
    collectCoverageFrom: [
        'controllers/**/*.js',
        'services/**/*.js',
        'middleware/**/*.js',
        'models/**/*.js',
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
