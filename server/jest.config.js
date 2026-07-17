module.exports = {
    testEnvironment: 'node',
    verbose: true,
    maxWorkers: 1,
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
            branches: 10,
            functions: 15,
            lines: 20,
            statements: 20,
        },
    },
};
