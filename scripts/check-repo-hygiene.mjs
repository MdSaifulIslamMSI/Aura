#!/usr/bin/env node
// Working-directory hygiene guard.
//
// Source-level scanners and the credential scanner (scripts/security-secret-scan.mjs)
// answer "is this content dangerous?". They do not answer "is my working tree a
// mess?", which is where real damage happens before anything is committed:
//
//   - Customer records dumped by an investigation sitting untracked at the repo
//     root, one `git add -A` from permanent git history. The credential scanner
//     does not catch this: a users collection dump holds no secrets, only PII.
//   - Machine-generated artifacts tracked in git, so the tree is permanently
//     dirty with a diff nobody authored and nobody reviewed.
//   - Scratch accumulating at the repo root where git reaches it.
//
// CI runs this with --strict, which promotes warnings to failures so none of
// these can land on main. Without --strict it is a local doctor: it reports
// what needs a decision without demanding one.
//
// Exit 0 = clean, exit 1 = problems found.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Override exists so the regression tests can point this guard at a throwaway
// repository fixture without running it against the real working tree.
const repoRoot = process.env.HYGIENE_REPO_ROOT
    ? path.resolve(process.env.HYGIENE_REPO_ROOT)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');
const asJson = process.argv.includes('--json');

const failures = [];
const warnings = [];
// Warnings that describe the machine rather than the tree. A fresh CI clone
// always has zero stashes, so promoting these to failures would make --strict
// assert something a checkout cannot control.
const localOnlyWarnings = [];

const fail = (message) => failures.push(message);
const warn = (message) => warnings.push(message);
const warnLocal = (message) => localOnlyWarnings.push(message);

const git = (...args) => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', shell: false });

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

// Mail providers whose addresses identify a person rather than a service or a
// role. Anything on these domains is treated as personal data unless allowlisted.
const PERSONAL_MAIL_DOMAINS = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'hotmail.com',
    'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com', 'aol.com',
    'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'gmx.com',
    'mail.com', 'yandex.com', 'zoho.com',
]);

// Domains reserved for documentation, or used by this repo's own throwaway
// fixtures. Never personal data by construction.
const SYNTHETIC_MAIL_DOMAINS = new Set([
    'example.com', 'example.test', 'example.org', 'example.net', 'example.invalid',
    'test.com', 'localhost', 'invalid', 'users.noreply.github.com',
    'auth.aura.invalid', 'aura.invalid', 'notauth.aura.invalid',
]);

// Local parts that are plainly placeholders rather than identities.
const PLACEHOLDER_LOCAL_PARTS = new Set([
    'your-email', 'your.email', 'admin', 'user', 'test', 'example', 'someone',
    'youremail', 'email', 'me', 'noreply', 'no-reply', 'support', 'info',
]);

// Files that legitimately contain personal-domain addresses: the owner's own
// published git identity, and fixtures that assert on it.
const PII_ALLOWED_FILES = new Set([
    '.gitleaks-baseline.json',
    'plugins/frontend-uiux-design-lab/.codex-plugin/plugin.json',
    'server/tests/activityEmailService.test.js',
    // The fixture addresses for this guard's own tests. Allowlisted as a whole
    // file, so do not paste real customer data into it.
    'server/tests/repoHygiene.test.js',
]);

// Tracked files that a process rewrites. They may be committed, but a large
// uncommitted diff means they are being hand-managed or a run left them dirty;
// either way the tree should be regenerated or reverted, not reviewed.
const GENERATED_TRACKED_FILES = [
    { path: 'app/public/status-snapshot.json', generator: 'server/services/statusService.js' },
    { path: 'app/public/status-snapshot.html', generator: 'server/services/statusService.js' },
];

// Never read: dependencies, build output, and archives.
const SKIP_PATH = /(^|\/)(node_modules|dist|build|coverage|desktop-release|\.git|security-reports)(\/|$)/i;
const SKIP_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.gz', '.woff',
    '.woff2', '.ttf', '.eot', '.mp4', '.webm', '.pptx', '.xlsx', '.asar',
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const toPosix = (value) => value.split(path.sep).join('/');

const listFiles = () => {
    const result = git('ls-files', '-co', '--exclude-standard');
    if (result.status !== 0) {
        throw new Error(`Unable to enumerate repository files: ${result.stderr || result.stdout}`);
    }
    const deleted = new Set((git('ls-files', '--deleted').stdout || '')
        .split(/\r?\n/).map((line) => line.trim()).filter(Boolean));

    return (result.stdout || '')
        .split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        .map(toPosix)
        .filter((file) => !deleted.has(file))
        .filter((file) => !SKIP_PATH.test(file));
};

// ---------------------------------------------------------------------------
// C1 - personal data in content the working tree can commit
// ---------------------------------------------------------------------------

const isSyntheticMail = (address) => {
    const at = address.lastIndexOf('@');
    if (at < 0) return true;
    const local = address.slice(0, at).toLowerCase();
    const domain = address.slice(at + 1).toLowerCase();
    if (SYNTHETIC_MAIL_DOMAINS.has(domain)) return true;
    if (domain.endsWith('.invalid') || domain.endsWith('.example')) return true;
    if (PLACEHOLDER_LOCAL_PARTS.has(local)) return true;
    return false;
};

const checkPersonalData = (files) => {
    const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
    let flagged = 0;

    for (const file of files) {
        if (PII_ALLOWED_FILES.has(file)) continue;
        let stat;
        try {
            stat = fs.statSync(path.join(repoRoot, file));
        } catch {
            continue;
        }
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
        if (SKIP_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;

        let text;
        try {
            text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
        } catch {
            continue;
        }

        const suspicious = new Set();
        for (const match of text.matchAll(emailPattern)) {
            const address = match[0];
            const at = address.lastIndexOf('@');
            const domain = address.slice(at + 1).toLowerCase();
            if (!PERSONAL_MAIL_DOMAINS.has(domain)) continue;
            if (isSyntheticMail(address)) continue;
            suspicious.add(address);
        }

        if (suspicious.size > 0) {
            flagged += 1;
            const sample = [...suspicious].slice(0, 3).join(', ');
            fail(`${file}: ${suspicious.size} personal email address(es) in git-visible content (${sample}${suspicious.size > 3 ? ', ...' : ''}). Add the path to PII_ALLOWED_FILES only if the address is already public, otherwise delete the file.`);
        }
    }

    if (flagged === 0) {
        console.log('[hygiene] no personal email addresses in tracked or untracked content.');
    }
};

// ---------------------------------------------------------------------------
// C2 - untracked files at the repo root
// ---------------------------------------------------------------------------

const checkRootClutter = () => {
    const untracked = (git('ls-files', '-o', '--exclude-standard').stdout || '')
        .split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(toPosix);

    const rootFiles = untracked.filter((file) => !file.includes('/'));
    if (rootFiles.length === 0) {
        console.log('[hygiene] no untracked files at the repo root.');
        return;
    }

    const listing = rootFiles.map((file) => `  ${file}`).join('\n');
    warn(`${rootFiles.length} untracked file(s) at the repo root are one \`git add -A\` from being committed:\n${listing}\n  Commit the ones that belong in the repo (deliverables belong under docs/) and ignore or delete the rest.`);
};

// ---------------------------------------------------------------------------
// C3 - machine-generated tracked files carrying a large uncommitted diff
// ---------------------------------------------------------------------------

const checkGeneratedDrift = () => {
    const diff = git('diff', '--numstat');
    const additions = new Map();
    for (const line of (diff.stdout || '').split(/\r?\n/)) {
        const [added, , file] = line.split('\t');
        if (!file) continue;
        if (/^\d+$/.test(added)) additions.set(toPosix(file.trim()), Number(added));
    }

    const drifted = [];
    for (const entry of GENERATED_TRACKED_FILES) {
        const added = additions.get(entry.path) || 0;
        if (added > 500) drifted.push(`${entry.path} (+${added} uncommitted lines)`);
    }

    if (drifted.length === 0) {
        console.log('[hygiene] no machine-generated tracked file is carrying a large uncommitted diff.');
        return;
    }

    const list = drifted.map((item) => `  ${item}`).join('\n');
    warn(`machine-generated file(s) are dirty in the working tree:\n${list}\n  These are written at runtime, not authored. Regenerate or revert them rather than committing the diff, or stop tracking them.`);
};

// ---------------------------------------------------------------------------
// C4 - destructive-git safety signal
// ---------------------------------------------------------------------------

const checkStashes = () => {
    const count = (git('stash', 'list').stdout || '')
        .split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
    if (count === 0) {
        console.log('[hygiene] no stashes present.');
        return;
    }
    warnLocal(`${count} stash entr${count === 1 ? 'y' : 'ies'} present. These hold uncommitted work that is not recoverable from the working tree - do not run \`git stash pop\` without checking which entry is yours, and do not \`git reset --hard\` over uncommitted changes.`);
};

// ---------------------------------------------------------------------------

const files = listFiles();
checkPersonalData(files);
checkRootClutter();
checkGeneratedDrift();
checkStashes();

for (const warning of [...warnings, ...localOnlyWarnings]) {
    console.log(strict ? `[hygiene] WARN ${warning}` : `[hygiene] WARN ${warning}`);
}

if (asJson) {
    console.log(JSON.stringify({ failures, warnings, localOnlyWarnings }, null, 2));
}

if (failures.length > 0) {
    console.error(`[hygiene] FAILED with ${failures.length} problem(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
}

if (strict && warnings.length > 0) {
    console.error(`[hygiene] FAILED: ${warnings.length} warning(s) promoted to failures by --strict.`);
    process.exit(1);
}

console.log(`[hygiene] OK - working directory is clean (${warnings.length + localOnlyWarnings.length} warning(s)).`);
process.exit(0);