#!/usr/bin/env node

import { HOSTED_BACKEND_ORIGIN } from '../app/config/vercelRoutingContract.mjs';

const frontendOrigin = String(process.env.PROD_FRONTEND_URL || 'https://aurapilot.vercel.app').replace(/\/+$/, '');
const hostedBackendOrigin = String(process.env.PROD_BACKEND_ORIGIN || HOSTED_BACKEND_ORIGIN).replace(/\/+$/, '');
const legacyHttpBackendOrigin = String(process.env.PROD_LEGACY_HTTP_BACKEND_ORIGIN || 'http://3.109.181.238:5000').replace(/\/+$/, '');

const checks = [];
const addCheck = (name, ok, details = {}) => {
    checks.push({ name, ok, ...details });
};

const readResponse = async (response) => {
    const text = await response.text();
    try {
        return { text, json: JSON.parse(text) };
    } catch {
        return { text, json: null };
    }
};

const request = async (url, options = {}) => {
    const startedAt = Date.now();
    try {
        const response = await fetch(url, { redirect: 'manual', ...options });
        const { text, json } = await readResponse(response);
        return {
            ok: true,
            response,
            status: response.status,
            elapsedMs: Date.now() - startedAt,
            text,
            json,
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message,
            elapsedMs: Date.now() - startedAt,
        };
    }
};

const header = (result, name) => result.response?.headers.get(name) || '';

const summarizeBody = (result) => String(result.text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);

const publicFrontendHeaders = async () => {
    const result = await request(`${frontendOrigin}/`);
    const csp = header(result, 'content-security-policy');
    addCheck('frontend home is served over HTTPS', result.ok && result.status >= 200 && result.status < 400, {
        status: result.status,
        elapsedMs: result.elapsedMs,
        hsts: Boolean(header(result, 'strict-transport-security')),
    });
    addCheck('frontend sends anti-clickjacking CSP header', result.ok && csp.includes("frame-ancestors 'none'"), {
        status: result.status,
        hasCsp: Boolean(csp),
        xFrameOptions: header(result, 'x-frame-options'),
    });
};

const loginRoute = async () => {
    const result = await request(`${frontendOrigin}/login`);
    addCheck('login route renders from production frontend', result.ok && result.status >= 200 && result.status < 400, {
        status: result.status,
        elapsedMs: result.elapsedMs,
        body: summarizeBody(result),
    });
};

const proxiedBackendHealth = async () => {
    const live = await request(`${frontendOrigin}/health/live`);
    addCheck('proxied health/live is alive', live.ok && live.status === 200 && live.json?.alive === true, {
        status: live.status,
        elapsedMs: live.elapsedMs,
        splitRuntimeEnabled: live.json?.topology?.splitRuntimeEnabled,
    });

    const ready = await request(`${frontendOrigin}/health/ready`, {
        headers: {
            Origin: frontendOrigin,
            Accept: 'application/json',
        },
    });
    addCheck('proxied health/ready is ready', ready.ok && ready.status === 200 && ready.json?.ready === true, {
        status: ready.status,
        elapsedMs: ready.elapsedMs,
        reason: ready.json?.reason || '',
        splitRuntimeEnabled: ready.json?.topology?.splitRuntimeEnabled,
    });
};

const unauthenticatedAuthSurface = async () => {
    const result = await request(`${frontendOrigin}/api/auth/session`, {
        headers: {
            Origin: frontendOrigin,
            Accept: 'application/json',
        },
    });
    addCheck('unauthenticated session is rejected without setting cookies', result.ok && result.status === 401 && !header(result, 'set-cookie'), {
        status: result.status,
        elapsedMs: result.elapsedMs,
        allowOrigin: header(result, 'access-control-allow-origin'),
        allowCredentials: header(result, 'access-control-allow-credentials'),
        setCookie: Boolean(header(result, 'set-cookie')),
    });

    const blockedCors = await request(`${frontendOrigin}/api/auth/session`, {
        headers: {
            Origin: 'https://evil.example',
            Accept: 'application/json',
        },
    });
    addCheck('untrusted origin is not granted credentialed CORS', blockedCors.ok && header(blockedCors, 'access-control-allow-origin') !== 'https://evil.example', {
        status: blockedCors.status,
        elapsedMs: blockedCors.elapsedMs,
        allowOrigin: header(blockedCors, 'access-control-allow-origin'),
        allowCredentials: header(blockedCors, 'access-control-allow-credentials'),
    });
};

const hostedBackendTransport = async () => {
    addCheck('hosted backend origin uses HTTPS', /^https:\/\//i.test(hostedBackendOrigin), {
        hostedBackendOrigin,
    });

    const directLive = await request(`${legacyHttpBackendOrigin}/health/live`);
    const directHttpPublic = directLive.ok && directLive.status >= 200 && directLive.status < 500;
    addCheck('plain HTTP backend is not publicly usable', !directHttpPublic, {
        status: directLive.status,
        elapsedMs: directLive.elapsedMs,
        legacyHttpBackendOrigin,
        error: directLive.error || '',
    });
};

await publicFrontendHeaders();
await loginRoute();
await proxiedBackendHealth();
await unauthenticatedAuthSurface();
await hostedBackendTransport();

const failed = checks.filter((check) => !check.ok);
console.log(JSON.stringify({
    frontendOrigin,
    hostedBackendOrigin,
    legacyHttpBackendOrigin,
    checks,
    failed: failed.map((check) => check.name),
}, null, 2));

if (failed.length > 0) {
    process.exitCode = 1;
}
