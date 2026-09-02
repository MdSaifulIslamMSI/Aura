#!/usr/bin/env node
// Phase 5B: CSP drift check. The Content-Security-Policy is maintained in four
// places (app/index.html meta, vercel.json, netlify.toml, and the Helmet config
// in server/index.js). This script asserts:
//   1. The three static copies are semantically identical to the canonical
//      policy in app/index.html (directive-by-directive, order-insensitive).
//   2. The server-side imgSrc directive matches the canonical img-src sources.
// Exit 1 on any drift.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '..', '..');

const read = (relative) => fs.readFileSync(path.join(repoDir, relative), 'utf8');

const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

// frame-ancestors is ignored inside <meta> per the CSP spec; the header copies
// (vercel.json / netlify.toml / server) are the enforcement point. Strip it
// from all copies so the meta vs header comparison is apples to apples for the
// directives the meta can actually enforce.
const normalizeHeaderPolicy = (value) => (
    normalize(String(value || '').replace(/frame-ancestors[^;]*(;|$)/g, ''))
);

const extractFromIndexHtml = () => {
    const source = read('app/index.html');
    const match = source.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
    if (!match) throw new Error('app/index.html: Content-Security-Policy meta tag not found');
    return normalizeHeaderPolicy(match[1]);
};

const extractFromVercelJson = () => {
    const source = read('vercel.json');
    const json = JSON.parse(source);
    const values = new Set();
    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        if (Array.isArray(node.headers)) {
            for (const header of node.headers) {
                if (String(header?.key || '').toLowerCase() === 'content-security-policy') {
                    values.add(normalize(header.value));
                }
            }
        }
        Object.values(node).forEach(walk);
    };
    walk(json);
    return [...values];
};

const extractFromNetlifyToml = () => {
    const source = read('netlify.toml');
    const values = new Set();
    const pattern = /Content-Security-Policy\s*=\s*"((?:[^"\\]|\\.)*)"/g;
    let match;
    while ((match = pattern.exec(source)) !== null) {
        values.add(normalize(match[1].replace(/\\"/g, '"')));
    }
    return [...values];
};

const extractServerImgSrc = () => {
    const source = read('server/index.js');
    const match = source.match(/imgSrc:\s*\[([^\]]+)\]/);
    if (!match) throw new Error('server/index.js: imgSrc directive not found');
    return match[1]
        .split(',')
        .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
};

// Parses a policy into sorted "directiveName: source1|source2" entries. CSP
// compares semantically as a set of directives; source order within a
// directive and whitespace around semicolons are irrelevant.
const parseDirectives = (value) => (
    normalizeHeaderPolicy(value)
        .split(';')
        .map((directive) => directive.trim().split(/\s+/).filter(Boolean))
        .filter((tokens) => tokens.length > 0)
        .map((tokens) => `${tokens[0]}: ${tokens.slice(1).sort().join(' ')}`)
        .sort()
);

const failures = [];
const canonical = extractFromIndexHtml();

const others = [
    ...extractFromVercelJson().map((value, i) => ({ file: `vercel.json#${i + 1}`, value })),
    ...extractFromNetlifyToml().map((value, i) => ({ file: `netlify.toml#${i + 1}`, value })),
];
const canonicalDirectives = parseDirectives(canonical);
for (const other of others) {
    const otherDirectives = parseDirectives(other.value);
    const canonicalSet = new Set(canonicalDirectives);
    const otherSet = new Set(otherDirectives);
    const missing = canonicalDirectives.filter((d) => !otherSet.has(d));
    const extra = otherDirectives.filter((d) => !canonicalSet.has(d));
    if (missing.length > 0 || extra.length > 0) {
        failures.push(
            `${other.file} CSP differs from app/index.html\n`
            + `    directives only in canonical: ${missing.join(' ; ') || '(none)'}\n`
            + `    directives only in ${other.file}: ${extra.join(' ; ') || '(none)'}`
        );
    }
}

const serverImgSrc = extractServerImgSrc().sort();
const canonicalImgSrc = canonical
    .match(/img-src([^;]*)/)?.[1]?.trim().split(/\s+/).filter(Boolean).sort() || [];
if (JSON.stringify(serverImgSrc) !== JSON.stringify(canonicalImgSrc)) {
    failures.push(
        `server/index.js imgSrc differs from app/index.html img-src:\n`
        + `  server:    ${serverImgSrc.join(' ')}\n`
        + `  canonical: ${canonicalImgSrc.join(' ')}`
    );
}

if (failures.length > 0) {
    console.error('[csp-drift] CSP drift detected:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
}

console.log('[csp-drift] OK — CSP copies in app/index.html, vercel.json, netlify.toml, and server/index.js are in sync.');
