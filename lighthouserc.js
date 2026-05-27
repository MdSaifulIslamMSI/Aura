const minPerformance = Number(process.env.LIGHTHOUSE_MIN_PERFORMANCE || 0.85);
const url = String(process.env.PERF_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

module.exports = {
  ci: {
    collect: {
      url: [url],
      numberOfRuns: 1,
      settings: {
        preset: 'desktop',
        throttlingMethod: 'simulate',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: minPerformance }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['warn', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['warn', { maxNumericValue: 300 }],
        'resource-summary:script:size': ['warn', { maxNumericValue: 900000 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: './.run-logs/lighthouse',
    },
  },
};
