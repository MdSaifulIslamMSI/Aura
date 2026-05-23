import http from 'k6/http';
import { check, sleep } from 'k6';

// k6 options defining scenarios for comprehensive load testing
export const options = {
  scenarios: {
    // 1. Baseline Load: Low, steady concurrency to establish performance baseline
    baseline: {
      executor: 'constant-vus',
      vus: 2,
      duration: '10s',
      exec: 'baselineTest',
    },
    // 2. Mixed Auth Traffic: Simulates normal users hitting health check, checking accounts, and sending OTPs
    mixed_traffic: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '10s', target: 10 }, // ramp up
        { duration: '15s', target: 10 }, // plateau
        { duration: '5s', target: 0 },  // ramp down
      ],
      exec: 'mixedTrafficTest',
    },
    // 3. Spike Test: Sudden surge of traffic simulating peak activity or flash mob login
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: 2,
      timeUnit: '1s',
      preAllocatedVUs: 5,
      maxVUs: 40,
      stages: [
        { duration: '5s', target: 30 }, // sudden spike
        { duration: '10s', target: 30 }, // hold spike
        { duration: '5s', target: 0 },  // cool down
      ],
      exec: 'spikeTest',
    },
    // 4. Rate-Limit Abuse Check: Rapidly spamming OTP requests to check if rate-limit (429) triggers
    rate_limit_abuse: {
      executor: 'constant-arrival-rate',
      rate: 15,
      timeUnit: '1s',
      duration: '10s',
      preAllocatedVUs: 5,
      maxVUs: 15,
      exec: 'rateLimitAbuseTest',
    },
    // 5. Soak Test: Continuous moderate load to verify server stability and connection/memory issues
    soak: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
      exec: 'soakTest',
    },
  },
  thresholds: {
    // Expecting rate limit abuse to return 429, so we tolerate some failures in aggregate
    http_req_failed: ['rate < 0.25'],
    // 95% of requests must complete under 1.5 seconds, and 99% under 3 seconds
    http_req_duration: ['p(95) < 1500', 'p(99) < 3000'],
  },
};

const baseUrl = (__ENV.AUTH_LOAD_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');

// Generate pseudo-random test user details
function getRandomUserIndex() {
  return Math.floor(Math.random() * 100) + 1; // Users 1 to 100
}

// Scenario executors

// Baseline: steady health check and user lookup
export function baselineTest() {
  const index = getRandomUserIndex();
  const phone = `+9199999${String(index).padStart(5, '0')}`;
  const email = `test_auth_load_user_${index}@example.test`;

  // 1. Health check
  const resHealth = http.get(`${baseUrl}/health`);
  check(resHealth, {
    'health responds 200': (res) => res.status === 200,
  });

  // 2. User exists check
  const payload = JSON.stringify({ phone, email });
  const params = { headers: { 'Content-Type': 'application/json' } };
  const resCheck = http.post(`${baseUrl}/api/auth/otp/check-user`, payload, params);
  check(resCheck, {
    'check-user responds 200': (res) => res.status === 200,
  });

  sleep(1);
}

// Mixed Traffic: normal operations and OTP sending
export function mixedTrafficTest() {
  const index = getRandomUserIndex();
  const phone = `+9199999${String(index).padStart(5, '0')}`;
  const email = `test_auth_load_user_${index}@example.test`;
  const params = { headers: { 'Content-Type': 'application/json' } };

  // 1. Check user (60% weight)
  if (Math.random() < 0.6) {
    const payload = JSON.stringify({ phone, email });
    const res = http.post(`${baseUrl}/api/auth/otp/check-user`, payload, params);
    check(res, {
      'check-user check': (res) => res.status === 200,
    });
  }
  // 2. Send OTP (30% weight)
  else if (Math.random() < 0.75) {
    const payload = JSON.stringify({ phone, email, purpose: 'login' });
    const res = http.post(`${baseUrl}/api/auth/otp/send`, payload, params);
    check(res, {
      'otp send check': (res) => [200, 429].includes(res.status), // 429 is fine due to rate limiters
    });
  }
  // 3. Health status (10% weight)
  else {
    const res = http.get(`${baseUrl}/health`);
    check(res, {
      'health check': (res) => res.status === 200,
    });
  }

  sleep(0.5 + Math.random());
}

// Spike: sudden lookup surge
export function spikeTest() {
  const index = getRandomUserIndex();
  const phone = `+9199999${String(index).padStart(5, '0')}`;
  const email = `test_auth_load_user_${index}@example.test`;
  const payload = JSON.stringify({ phone, email });
  const params = { headers: { 'Content-Type': 'application/json' } };

  const res = http.post(`${baseUrl}/api/auth/otp/check-user`, payload, params);
  check(res, {
    'spike lookup responds 200': (res) => res.status === 200,
  });

  sleep(0.1);
}

// Rate-Limit Abuse: flood a specific user to force 429
export function rateLimitAbuseTest() {
  const email = 'test_auth_load_user_99@example.test'; // Abuse single user
  const phone = '+919999900099';
  const payload = JSON.stringify({ phone, email, purpose: 'login' });
  const params = { headers: { 'Content-Type': 'application/json' } };

  const res = http.post(`${baseUrl}/api/auth/otp/send`, payload, params);
  check(res, {
    'rate limit responds with 200 or 429': (res) => [200, 429].includes(res.status),
  });

  sleep(0.1);
}

// Soak: sustained baseline load
export function soakTest() {
  const index = getRandomUserIndex();
  const phone = `+9199999${String(index).padStart(5, '0')}`;
  const email = `test_auth_load_user_${index}@example.test`;
  const params = { headers: { 'Content-Type': 'application/json' } };

  // Mix of requests to health and user checks
  const resHealth = http.get(`${baseUrl}/health`);
  check(resHealth, { 'soak health 200': (res) => res.status === 200 });

  const payload = JSON.stringify({ phone, email });
  const resCheck = http.post(`${baseUrl}/api/auth/otp/check-user`, payload, params);
  check(resCheck, { 'soak check-user 200': (res) => res.status === 200 });

  sleep(1);
}
