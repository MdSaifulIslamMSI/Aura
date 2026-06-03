export const safeBaseUrl = () => {
  const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:5000';
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(baseUrl);
  const staging = __ENV.ALLOW_STAGING === 'yes';
  if (!local && !staging) {
    throw new Error('Refusing non-local k6 target unless ALLOW_STAGING=yes is set.');
  }
  return baseUrl.replace(/\/+$/, '');
};

export const smokeOptions = {
  thresholds: {
    http_req_failed: ['rate<0.20'],
    http_req_duration: ['p(95)<1500'],
  },
};
