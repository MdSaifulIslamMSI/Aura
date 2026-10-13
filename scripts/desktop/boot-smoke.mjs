#!/usr/bin/env node

/**
 * Desktop boot smoke test — launches the real Electron shell and asserts that it
 * actually reaches a usable state.
 *
 * Why this exists: `scripts/desktop/verify-packaged-runtime.mjs` proves the
 * packaged artifact carries config/backend-origin.json and that the packaged
 * runtime module loads. That is a packaging assertion, not a boot assertion.
 * Nothing in CI previously launched Electron, so a regression that broke window
 * creation, the IPC bridge, or the local runtime server would only have been
 * found by a human running `npm run desktop:start` on a desktop OS.
 *
 * What it asserts:
 *   1. The main process starts and reaches a BrowserWindow.
 *   2. That window actually loaded the loopback runtime origin at /login.
 *   3. The local runtime serves the built SPA over HTTP.
 *   4. The DNS-rebinding Host guard is armed in the live server (421).
 *   5. The process is still alive at the end, i.e. it did not crash after boot.
 *
 * Usage: npm run test:desktop:boot
 * Requires `npm run desktop:frontend:build` to have produced app/dist.
 * On a headless Linux runner, wrap it: xvfb-run -a npm run test:desktop:boot
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

const BOOT_MARKER = '[desktop:boot-smoke]';
const BOOT_TIMEOUT_MS = Number(process.env.AURA_DESKTOP_BOOT_TIMEOUT_MS || 90_000);

// Must stay inside the range desktop/main.cjs accepts for AURA_DESKTOP_PORT
// (resolveRequestedRuntimePort): DEFAULT_RUNTIME_PORT through
// DEFAULT_RUNTIME_PORT + STABLE_RUNTIME_FALLBACK_PORTS. A port outside that
// window is silently ignored and the runtime picks its own, which would race
// against anything else holding it.
const MIN_RUNTIME_PORT = 47_831;
const MAX_RUNTIME_PORT = 47_841;

const log = (message) => console.log(`[desktop-boot] ${message}`);
const fail = (message) => {
    console.error(`[desktop-boot] FAIL ${message}`);
    process.exit(1);
};

const distIndex = path.join(repoRoot, 'app', 'dist', 'index.html');
if (!fs.existsSync(distIndex)) {
    fail(`Frontend build missing at ${distIndex}. Run "npm run desktop:frontend:build" first.`);
}

const isFreePort = (port) => new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
});

const findRuntimePort = async () => {
    for (let port = MIN_RUNTIME_PORT; port <= MAX_RUNTIME_PORT; port += 1) {
        if (await isFreePort(port)) return port;
    }
    fail(`No free port between ${MIN_RUNTIME_PORT} and ${MAX_RUNTIME_PORT}.`);
    return null;
};

const httpRequest = (url, { headers = {} } = {}) => new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request({
        headers,
        hostname: '127.0.0.1',
        port: target.port,
        path: `${target.pathname}${target.search}`,
        timeout: 15_000,
    }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({
            status: response.statusCode,
            contentType: String(response.headers['content-type'] || ''),
            body: Buffer.concat(chunks).toString('utf8'),
        }));
    });
    request.on('timeout', () => request.destroy(new Error('HTTP probe timed out.')));
    request.on('error', reject);
    request.end();
});

const electronBinary = (() => {
    try {
        // The `electron` package's main export is the absolute path to the binary.
        return require('electron');
    } catch {
        fail('Could not resolve the electron binary. Run "npm install" at the repo root.');
        return null;
    }
})();

const port = await findRuntimePort();

// Containers and CI runners have no usable sandbox namespace or display.
const electronArgs = [repoRoot];
if (process.env.CI || process.env.AURA_DESKTOP_SMOKE_NO_SANDBOX === '1') {
    electronArgs.push('--no-sandbox');
}

const child = spawn(electronBinary, electronArgs, {
    cwd: repoRoot,
    detached: process.platform !== 'win32',
    env: {
        ...process.env,
        AURA_DESKTOP_BOOT_SMOKE: '1',
        AURA_DESKTOP_PORT: String(port),
        // The smoke shell must never prompt for a restart mid-assertion.
        AURA_DESKTOP_AUTO_UPDATE: 'false',
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
});

const output = { stdout: '', stderr: '' };
child.stdout.on('data', (chunk) => {
    output.stdout += chunk.toString();
});
child.stderr.on('data', (chunk) => {
    output.stderr += chunk.toString();
});

const killElectron = () => {
    if (child.exitCode !== null || child.signalCode) return;
    if (process.platform === 'win32') {
        // Electron spawns a process tree; a bare kill() orphans the renderers.
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        return;
    }
    try {
        process.kill(-child.pid, 'SIGKILL');
    } catch {
        child.kill('SIGKILL');
    }
};

let exiting = false;
const cleanupAndExit = (code) => {
    if (exiting) return;
    exiting = true;
    killElectron();
    process.exit(code);
};

process.on('exit', killElectron);
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => cleanupAndExit(1));
}

let unexpectedExit = null;
child.on('exit', (code, signal) => {
    unexpectedExit = `electron exited early (code=${code}, signal=${signal})`;
});

// Wait for the marker main.cjs writes once the window has loaded.
const bootReport = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), BOOT_TIMEOUT_MS);
    const poll = setInterval(() => {
        const line = output.stdout.split(/\r?\n/).find((entry) => entry.startsWith(BOOT_MARKER));
        if (!line) {
            if (unexpectedExit) {
                clearInterval(poll);
                clearTimeout(timer);
                resolve(null);
            }
            return;
        }
        clearInterval(poll);
        clearTimeout(timer);
        try {
            resolve(JSON.parse(line.slice(BOOT_MARKER.length).trim()));
        } catch {
            resolve(null);
        }
    }, 150);
});

const dumpOutput = () => {
    if (output.stdout.trim()) console.error(`--- electron stdout ---\n${output.stdout.trim()}`);
    if (output.stderr.trim()) console.error(`--- electron stderr ---\n${output.stderr.trim()}`);
};

if (!bootReport) {
    dumpOutput();
    if (unexpectedExit) {
        fail(`${unexpectedExit} before the window loaded.`);
    }
    fail(
        `No boot marker within ${BOOT_TIMEOUT_MS}ms. `
        + 'If a dev instance is already running, Electron\'s single-instance lock makes this shell exit immediately — close it first. '
        + 'On a headless Linux runner, retry under xvfb-run.'
    );
}

log(`booted ${bootReport.version} on ${bootReport.platform}`);
log(`runtime url: ${bootReport.runtimeUrl}`);
log(`window url:  ${bootReport.windowUrl}`);

if (!bootReport.ok) {
    dumpOutput();
    fail('Electron reported a boot with no loaded window URL.');
}

const runtimeOrigin = new URL(bootReport.runtimeUrl).origin;
const windowUrl = new URL(bootReport.windowUrl);

if (windowUrl.origin !== runtimeOrigin) {
    fail(`Window loaded ${windowUrl.origin} but the runtime origin is ${runtimeOrigin}.`);
}
if (windowUrl.pathname !== '/login') {
    fail(`Window loaded ${windowUrl.pathname} but the desktop startup route is /login.`);
}
if (!windowUrl.searchParams.get('desktopRuntimeVersion')) {
    fail('Window URL is missing the desktopRuntimeVersion startup parameter.');
}

// The live runtime must actually serve the built SPA.
const index = await httpRequest(`${runtimeOrigin}/`);
if (index.status !== 200) {
    fail(`Runtime served GET / with HTTP ${index.status}, expected 200.`);
}
if (!/text\/html/i.test(index.contentType)) {
    fail(`Runtime served GET / as "${index.contentType}", expected text/html.`);
}
if (!/<div id="root"|<script/i.test(index.body)) {
    fail('Runtime served GET / but the body does not look like the built SPA shell.');
}
log('runtime serves the built SPA');

// The DNS-rebinding guard must be armed in the live server, not just in unit tests.
const rebound = await httpRequest(`${runtimeOrigin}/`, { headers: { Host: 'evil.example.com' } });
if (rebound.status !== 421) {
    fail(`Runtime answered a foreign Host header with HTTP ${rebound.status}, expected 421.`);
}
log('foreign Host header rejected with 421');

if (child.exitCode !== null || child.signalCode) {
    fail(`Electron exited during the assertions (code=${child.exitCode}, signal=${child.signalCode}).`);
}

log('OK — the desktop shell boots, loads the runtime origin, and stays alive.');
cleanupAndExit(0);