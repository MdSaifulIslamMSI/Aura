#!/usr/bin/env node
// Audits crypto-format-registry.json against the actual repository.
//
// The failure this exists to prevent: a key-derivation format ships, is frozen
// "for reads only" in a code comment, and then sits there forever at whatever
// cost it was written with. Every one of those paths is individually invisible —
// the comment looks like diligence — and collectively they are the dominant
// source of long-lived crypto debt.
//
// So the registry is not documentation. This script makes it load-bearing:
//
//   1. Every registered format must point at a file that exists. A registry that
//      drifts from the code is worse than none, because it reads as verified.
//   2. Every LEGACY_READ format must declare retireAfter AND migrationTrigger.
//      "Frozen for reads only" without a retirement route is a permanent
//      liability and is rejected here.
//   3. Every legacy key-derivation site found in production code must be
//      registered. An unregistered frozen derivation is a hard failure.
//
// Usage: node scripts/security/crypto-format-audit.mjs [--json] [--root <dir>]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDir, '..', '..');
const REGISTRY_RELATIVE_PATH = 'config/security/crypto-format-registry.json';

const VALID_STATUSES = new Set(['ACTIVE', 'LEGACY_READ', 'RETIRED']);

const parseArgs = (argv) => {
    let root = defaultRoot;
    let json = false;
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--root') {
            root = path.resolve(argv[i + 1] || defaultRoot);
            i += 1;
        } else if (argv[i] === '--json') {
            json = true;
        }
    }
    return { root, json: json || !argv.includes('--quiet') };
};

// Markers that a derivation is frozen for reads only. A site carrying one of
// these must appear in the registry as LEGACY_READ (or RETIRED).
// The `m` flag matters: this is tested against whole-file content, so without
// it `^` anchors at offset 0 only and no frozen marker is ever detected.
const LEGACY_KDF_MARKERS = [
    { label: 'frozen-derivation', regex: /^\s*(?:\/\/|\*)?\s*(?:Frozen|frozen)\s*:/m },
];

const LEGACY_KDF_PATTERNS = [
    {
        id: 'scrypt-literal-salt',
        // scryptSync(<anything-without-comma>, '<literal>', keylen) with no
        // options object: a fixed salt and Node's default cost. Note the first
        // argument class is [^,]+ and not [^,()]+ — real call sites pass
        // expressions like String(s || ''), which a paren-free class silently
        // skips. This exact shape is behind three separate findings.
        regex: /scryptSync\(\s*[^,]+,\s*(['"`][^'"`]*['"`])\s*,\s*\d+\s*[,)]/,
        recommendation: 'scrypt with a literal salt and no explicit cost params. Use a per-record random salt and pin {N,r,p,maxmem}, or derive via HKDF (server/utils/cryptoKdf.js).',
    },
    {
        id: 'bare-sha256-kdf',
        // createHash('sha256'|'sha512').update(<secret-ish>) used as a key
        // derivation. Single compression round: no extract step, no salt, no
        // work factor, so an operator-chosen secret is dictionary-attackable
        // against a captured ciphertext via the GCM auth-tag oracle.
        regex: /createHash\(\s*['"](?:sha256|sha512)['"]\s*\)\s*\.update\(\s*[^)]*(?:SECRET|secret|_KEY|\bKEY\b|\bkey\b|getSecret|password|PASSWORD|process\.env)/,
        recommendation: 'A bare SHA-256 over a secret is not a KDF (no extract step, no work factor). Use HKDF for high-entropy secrets or scrypt for passphrase input.',
    },
];

const PRODUCTION_PREFIXES = ['server/', 'scripts/production/', 'infra/', 'desktop/', 'gateway/', 'app/src/'];

const EXCLUDED_PARTS = new Set([
    'node_modules', 'tests', 'test', '__tests__', 'dist', 'build', 'coverage',
    '.git', 'reports', 'fixtures', 'scripts/security', 'docs',
]);

const isProductionPath = (relativePath) => {
    if (EXCLUDED_PARTS.has(relativePath.split('/').pop())) return false;
    if (/(?:^|\/)(?:tests?|__tests__|fixtures)\//i.test(relativePath)) return false;
    if (/\.test\.[cm]?[jt]sx?$/.test(relativePath)) return false;
    if (/^scripts\/i18n\//.test(relativePath)) return false;
    return PRODUCTION_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
};

const walk = (dir, out = []) => {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.github') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (EXCLUDED_PARTS.has(entry.name)) continue;
            walk(full, out);
        } else if (/\.(?:[cm]?js|ts)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
};

// Detection runs against whole-file content rather than line by line: the OTP
// flow-token legacy derivation is
//     createHash('sha256')
//         .update(`${getSecret()}:${CONTEXT}`)
//         .digest();
// which a per-line scan cannot see. Identifier uses are excluded explicitly,
// since a truncated digest (keyFingerprint, correlation id, content bucket) is
// not key material — the same distinction the PQC allowlist already draws for
// catalogArtworkService.js and productImageResolver.js.
const SECRET_ARGUMENT = /(?:SECRET|secret|_KEY|\bKEY\b|\bkey\b|getSecret|password|PASSWORD|process\.env)/;
const IDENTIFIER_USE = /\.\s*slice\s*\(|\bFingerprint\b|\bfingerprint\b|\bCorrelationId\b|\bcorrelationId\b/;

const findLegacyKdfSites = (content) => {
    const sites = [];
    const lineAt = (index) => content.slice(0, index).split(/\r?\n/).length;

    // The signal is NOT "literal salt" — it is "three-argument scrypt", which
    // means no options object and therefore Node's default N=16384 regardless of
    // whether the salt is a string literal, a named constant, or a parameter.
    // Matching the literal form alone missed three of the four real sites in
    // this repo, because two pass a constant and one passes a variable.
    // A pinned four-argument call correctly does not match.
    const scryptRe = /scryptSync\(\s*[^,]+,\s*[^,]+,\s*[^,)]+\s*\)/g;
    for (const match of content.matchAll(scryptRe)) {
        sites.push({ line: lineAt(match.index), pattern: 'scrypt-literal-salt', text: match[0].trim().slice(0, 160) });
    }

    // Bare SHA-256/SHA-512 key derivation, possibly spanning several lines.
    // `.digest()` with no encoding argument is the common form and must match,
    // so the encoding argument is optional. Group 3 captures everything between
    // .update(...) and .digest(, group 4 everything after it — the identifier
    // tell (.slice(0,16) into a keyFingerprint) lives in group 4.
    const hashRe = /createHash\(\s*['"](?:sha256|sha512)['"]\s*\)([\s\S]{0,240}?)\.update\(\s*([^)]{0,200}?)\)\s*([\s\S]{0,160}?)\.digest\(\s*(?:['"][^'"]*['"]\s*)?\)([\s\S]{0,160}?)(?:;|\n\s*\n)/g;
    for (const match of content.matchAll(hashRe)) {
        const argument = match[2] || '';
        const surrounding = `${match[3] || ''}${match[4] || ''}`;
        if (!SECRET_ARGUMENT.test(argument)) continue;
        if (IDENTIFIER_USE.test(surrounding)) continue;
        sites.push({
            line: lineAt(match.index),
            pattern: 'bare-sha256-kdf',
            text: `${match[0]}...`.trim().slice(0, 160).replace(/\s+/g, ' '),
        });
    }

    return sites;
};

export const auditCryptoFormats = ({ root = defaultRoot } = {}) => {
    const registryPath = path.join(root, REGISTRY_RELATIVE_PATH);
    const findings = [];
    const add = (severity, code, message, evidence) => findings.push({ severity, code, message, evidence });

    let registry;
    try {
        registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    } catch (error) {
        return {
            status: 'fail',
            findings: [{
                severity: 'blocker',
                code: 'registry_unreadable',
                message: `Cannot read ${REGISTRY_RELATIVE_PATH}: ${error.message}`,
                evidence: { file: REGISTRY_RELATIVE_PATH },
            }],
            summary: { total: 0, active: 0, legacyRead: 0, retired: 0, blockers: 1 },
        };
    }

    const formats = Array.isArray(registry.formats) ? registry.formats : [];

    // 1. Registry integrity: evidence must exist, ids unique, statuses valid.
    const seenIds = new Set();
    for (const format of formats) {
        const evidence = format?.evidence || format?.implementation;
        if (!format?.id) {
            add('blocker', 'registry_missing_id', 'A registry entry has no id.', { file: REGISTRY_RELATIVE_PATH });
            continue;
        }
        if (seenIds.has(format.id)) {
            add('blocker', 'registry_duplicate_id', `Duplicate registry id "${format.id}".`, { file: REGISTRY_RELATIVE_PATH });
        }
        seenIds.add(format.id);

        if (!VALID_STATUSES.has(format.status)) {
            add('blocker', 'registry_bad_status', `Format "${format.id}" has invalid status "${format.status}".`, { file: REGISTRY_RELATIVE_PATH });
        }
        if (!evidence) {
            add('blocker', 'registry_missing_evidence', `Format "${format.id}" declares no implementation/evidence file.`, { file: REGISTRY_RELATIVE_PATH });
        } else if (!existsSync(path.join(root, evidence))) {
            add('blocker', 'registry_phantom_evidence', `Format "${format.id}" points at ${evidence}, which does not exist. A registry that drifts from the code reads as verified when it is not.`, { file: evidence });
        }

        // 2. Every legacy format needs a retirement route.
        if (format.status === 'LEGACY_READ') {
            if (!format.retireAfter) {
                add('blocker', 'legacy_no_retire_date', `LEGACY_READ format "${format.id}" has no retireAfter date. A frozen derivation with no end date is a permanent liability.`, { file: evidence });
            }
            if (!format.migrationTrigger) {
                add('blocker', 'legacy_no_migration_trigger', `LEGACY_READ format "${format.id}" has no migrationTrigger. State the concrete mechanism that retires it.`, { file: evidence });
            }
        }
    }

    // 3. Unregistered legacy KDF sites in production code.
    const files = walk(root);
    const scanned = [];
    const legacySites = [];
    for (const absolute of files) {
        const relative = path.relative(root, absolute).split(path.sep).join('/');
        if (!isProductionPath(relative)) continue;
        let content;
        try {
            content = readFileSync(absolute, 'utf8');
        } catch {
            continue;
        }
        scanned.push(relative);
        const frozenMarker = LEGACY_KDF_MARKERS.some((m) => m.regex.test(content));
        for (const site of findLegacyKdfSites(content)) {
            legacySites.push({ ...site, file: relative, fileContent: content, fileHasFrozenMarker: frozenMarker });
        }
    }

    const registeredFiles = new Set(formats.map((f) => String(f.implementation || '').split(path.sep).join('/')));

    for (const site of legacySites) {
        // Tolerated only when the file is BOTH registered in the registry AND
        // carries an explicit "Frozen:" marker. Requiring both means a new file
        // cannot smuggle in a fixed-salt derivation by naming a variable
        // "legacy" — the declaration has to exist in the registry too.
        const isDeclaredLegacy = registeredFiles.has(site.file) && site.fileHasFrozenMarker;

        if (isDeclaredLegacy) {
            add('info', 'legacy_site_declared', `Declared legacy derivation: ${site.file}:${site.line} (${site.pattern}).`, { file: site.file, line: site.line });
        } else {
            add('blocker', 'unregistered_legacy_kdf', `Unregistered legacy key derivation at ${site.file}:${site.line} (${site.pattern}). ${LEGACY_KDF_PATTERNS.find((p) => p.id === site.pattern).recommendation} Register it in ${REGISTRY_RELATIVE_PATH} if it is a deliberate frozen read path.`, { file: site.file, line: site.line });
        }
    }

    const summary = {
        total: formats.length,
        active: formats.filter((f) => f?.status === 'ACTIVE').length,
        legacyRead: formats.filter((f) => f?.status === 'LEGACY_READ').length,
        retired: formats.filter((f) => f?.status === 'RETIRED').length,
        filesScanned: scanned.length,
        blockers: findings.filter((f) => f.severity === 'blocker').length,
    };

    return { status: summary.blockers > 0 ? 'fail' : 'pass', findings, summary };
};

export const renderCryptoFormatAuditMarkdown = (result) => {
    const lines = [
        '# Crypto format lifecycle audit',
        '',
        `Status: **${result.status}**`,
        '',
        `- Formats registered: ${result.summary.total}`,
        `- Active: ${result.summary.active}`,
        `- Legacy (read-only): ${result.summary.legacyRead}`,
        `- Retired: ${result.summary.retired}`,
        `- Production files scanned: ${result.summary.filesScanned ?? 0}`,
        '',
    ];
    if (result.findings.length) {
        lines.push('## Findings', '');
        for (const finding of result.findings) {
            lines.push(`- \`${finding.severity}\` **${finding.code}** — ${finding.message}`);
        }
        lines.push('');
    }
    return `${lines.join('\n')}\n`;
};

const main = () => {
    const options = parseArgs(process.argv.slice(2));
    const result = auditCryptoFormats({ root: options.root });
    const reportDir = path.join(options.root, 'reports', 'security');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(path.join(reportDir, 'crypto-format-audit.json'), `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(path.join(reportDir, 'crypto-format-audit.md'), renderCryptoFormatAuditMarkdown(result));

    console.log(`[crypto-format-audit] ${result.status}: ${result.summary.total} format(s), ${result.summary.legacyRead} legacy, ${result.summary.blockers} blocker(s).`);
    for (const finding of result.findings.filter((f) => f.severity === 'blocker')) {
        console.error(`  blocker ${finding.code}: ${finding.message}`);
    }
    if (result.status === 'fail') process.exit(1);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}