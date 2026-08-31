#!/usr/bin/env node
'use strict';

/**
 * Edge WAF live verification. Asserts that the free ModSecurity/CRS stack
 * actually BLOCKS the attack classes the AWS WAF used to cover, and passes
 * benign traffic through to the backend.
 *
 * Usage:
 *   node scripts/security/edge-waf-verification.mjs [--base-url http://127.0.0.1:8080]
 *
 * Exit codes: 0 = all assertions passed, 1 = one or more failed.
 */

const args = process.argv.slice(2);
const baseUrlIndex = args.indexOf('--base-url');
const baseUrl = (baseUrlIndex >= 0 ? args[baseUrlIndex + 1] : 'http://127.0.0.1:8080').replace(/\/$/, '');

const WAIT_TIMEOUT_MS = 90_000;
const WAIT_INTERVAL_MS = 2_000;

let failures = 0;
let passed = 0;

const record = (name, ok, detail) => {
  if (ok) passed += 1;
  else failures += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const fetchWithTimeout = async (url, timeoutMs = 10_000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
};

const waitUntilReady = async () => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/api/products`);
      if (response.status === 200) return true;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS));
  }
  throw new Error(`WAF never became ready at ${baseUrl} (last error: ${lastError})`);
};

// SQLi, XSS, and path-traversal probes, each URL-encoded so only the WAF's
// request rules (not client-side decoding) can detect them.
const attackProbes = [
  {
    name: 'SQL injection is blocked',
    url: `${baseUrl}/api/products?id=1%20OR%201%3D1`,
    detail: 'id=1 OR 1=1',
  },
  {
    name: 'XSS injection is blocked',
    url: `${baseUrl}/api/search?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E`,
    detail: '<script>alert(1)</script>',
  },
  {
    name: 'Path traversal is blocked',
    url: `${baseUrl}/api/download?file=%2e%2e%2f%2e%2e%2fetc%2fpasswd`,
    detail: '../../etc/passwd',
  },
  {
    name: 'Unix command injection probe is blocked',
    url: `${baseUrl}/api/ping?host=127.0.0.1%3Bcat%20%2Fetc%2fpasswd`,
    detail: ';cat /etc/passwd',
  },
];

const main = async () => {
  console.log(`[edge-waf-verify] waiting for WAF at ${baseUrl}...`);
  await waitUntilReady();
  console.log('[edge-waf-verify] WAF is ready.');

  const benign = await fetchWithTimeout(`${baseUrl}/api/products`);
  record('benign traffic passes through to the backend', benign.status === 200, `status ${benign.status}`);

  for (const probe of attackProbes) {
    const response = await fetchWithTimeout(probe.url);
    // CRS in blocking mode answers 403 for blocked requests.
    const blocked = response.status === 403 || response.status === 406;
    record(probe.name, blocked, `status ${response.status} (${probe.detail})`);
  }

  console.log(`[edge-waf-verify] ${passed} passed, ${failures} failed.`);
  // Set the exit code instead of calling process.exit(): exiting abruptly
  // from inside an async context crashes Node on Windows (libuv async.c).
  process.exitCode = failures === 0 ? 0 : 1;
};

main().catch((error) => {
  console.error(`[edge-waf-verify] ${error.message}`);
  process.exitCode = 1;
});
