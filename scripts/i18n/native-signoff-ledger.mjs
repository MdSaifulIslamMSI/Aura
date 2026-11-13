import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
    auditSignoffLedger,
    createSignoffRecord,
    normalizeSignoffLedger,
} = require('./stable-catalog-policy.cjs');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '../..');
const reviewedDir = path.join(repoDir, 'app/src/i18n/messages/reviewed');
const qualityDir = path.join(repoDir, 'app/src/i18n/quality');
const ledgerPath = path.join(qualityDir, 'nativeSignoffLedger.json');
const requiredLocalesPath = path.join(qualityDir, 'requiredLocales.json');
const nativeAuditPath = path.join(qualityDir, 'nativeReviewAudit.json');

const readJson = (filePath, fallback = null) => {
    if (!fs.existsSync(filePath)) {
        if (fallback !== null) return fallback;
        throw new Error(`Missing required JSON file: ${filePath}`);
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const parseArgs = (argv) => {
    const parsed = {};
    for (const arg of argv) {
        if (!arg.startsWith('--')) continue;
        const eqIdx = arg.indexOf('=');
        if (eqIdx === -1) {
            parsed[arg.slice(2)] = true;
        } else {
            parsed[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
        }
    }
    return parsed;
};

const sortApprovals = (approvals = {}) => {
    const sorted = {};
    for (const locale of Object.keys(approvals).sort()) {
        const entries = approvals[locale];
        if (!entries || typeof entries !== 'object') continue;
        const keys = Object.keys(entries).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        if (keys.length === 0) continue;
        sorted[locale] = Object.fromEntries(keys.map((id) => [id, entries[id]]));
    }
    return sorted;
};

const writeLedger = (ledger) => {
    const payload = {
        version: 1,
        description: ledger.description
            || 'Hash-bound human linguistic signoffs per (locale, messageId). Valid approvals graduate matching translations out of nativeReviewAudit.json and automatically invalidate whenever English source or translated copy changes.',
        approvals: sortApprovals(ledger.approvals),
    };
    fs.writeFileSync(ledgerPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

const loadCatalogContext = () => {
    const requiredLocales = readJson(requiredLocalesPath);
    const sourceCatalog = readJson(path.join(reviewedDir, 'en.json'));
    const catalogsByLocale = Object.fromEntries(
        requiredLocales
            .filter((loc) => loc !== 'en')
            .map((loc) => [loc, readJson(path.join(reviewedDir, `${loc}.json`), {})])
    );
    const ledger = normalizeSignoffLedger(readJson(ledgerPath, {}));
    return { requiredLocales, sourceCatalog, catalogsByLocale, ledger };
};

const printHelp = () => {
    console.log([
        'Usage:',
        '  npm run i18n:signoff                                  Show native signoff ledger status',
        '  npm run i18n:signoff:check                            Fail if ledger contains stale or invalid signoffs',
        '  node scripts/i18n/native-signoff-ledger.mjs --approve --locale=es --reviewer="Name" --ids=id1,id2 [--dry-run]',
        '  node scripts/i18n/native-signoff-ledger.mjs --approve --locale=es --reviewer="Name" --ids-file=reviewed.txt',
        '  node scripts/i18n/native-signoff-ledger.mjs --prune   Remove stale or invalid ledger entries',
    ].join('\n'));
};

const main = () => {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || args.h) {
        printHelp();
        return;
    }

    const { requiredLocales, sourceCatalog, catalogsByLocale, ledger } = loadCatalogContext();

    if (args.approve) {
        const locale = String(args.locale || '').trim();
        const reviewer = String(args.reviewer || '').trim();
        if (!locale || locale === 'en' || locale === 'en-XA' || !requiredLocales.includes(locale)) {
            throw new Error(`Invalid signoff target locale: ${locale || '(empty)'}`);
        }
        const idsFromArg = typeof args.ids === 'string'
            ? args.ids.split(',').map((s) => s.trim()).filter(Boolean)
            : [];
        const idsFromFile = typeof args['ids-file'] === 'string'
            ? fs.readFileSync(path.resolve(repoDir, args['ids-file']), 'utf8')
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter((s) => s && !s.startsWith('#'))
            : [];
        const ids = [...new Set([...idsFromArg, ...idsFromFile])];
        if (ids.length === 0) {
            throw new Error('Explicit --ids=... or --ids-file=... is required to record native signoffs.');
        }

        const catalog = catalogsByLocale[locale] || {};
        ledger.approvals[locale] = ledger.approvals[locale] || {};
        let recorded = 0;
        for (const id of ids) {
            if (!Object.prototype.hasOwnProperty.call(sourceCatalog, id)) {
                throw new Error(`Unknown source message ID: ${id}`);
            }
            ledger.approvals[locale][id] = createSignoffRecord({
                sourceMessage: sourceCatalog[id],
                translatedMessage: catalog[id],
                reviewer,
                reviewedAt: typeof args['reviewed-at'] === 'string' ? args['reviewed-at'] : new Date().toISOString(),
            });
            recorded += 1;
        }
        if (!args['dry-run']) {
            writeLedger(ledger);
        }
        console.log(`${args['dry-run'] ? '[dry-run] Would record' : 'Recorded'} ${recorded} native signoff(s) for ${locale} by "${reviewer}".`);
        return;
    }

    const audit = auditSignoffLedger({
        ledger,
        sourceCatalog,
        catalogsByLocale,
        requiredLocales,
    });

    if (args.prune) {
        const badSet = new Set([
            ...audit.staleEntries.map((e) => `${e.locale}\u0000${e.id}`),
            ...audit.invalidEntries.map((e) => `${e.locale}\u0000${e.id}`),
        ]);
        for (const [locale, entries] of Object.entries(ledger.approvals)) {
            for (const id of Object.keys(entries)) {
                if (badSet.has(`${locale}\u0000${id}`)) {
                    delete entries[id];
                }
            }
        }
        writeLedger(ledger);
        console.log(`Pruned ${badSet.size} stale/invalid native signoff record(s); retained ${audit.validEntries.length}.`);
        return;
    }

    const nativeAudit = readJson(nativeAuditPath, []);
    const auditPairsByLocale = {};
    for (const group of nativeAudit) {
        for (const target of group.targets || []) {
            auditPairsByLocale[target.locale] = (auditPairsByLocale[target.locale] || 0)
                + (Array.isArray(target.ids) ? target.ids.length : 0);
        }
    }

    console.log('Native Signoff Ledger Audit');
    console.log(`- Valid signed-off pairs: ${audit.validEntries.length}`);
    console.log(`- Stale (digest mismatch) pairs: ${audit.staleEntries.length}`);
    console.log(`- Invalid records: ${audit.invalidEntries.length}`);
    console.log(`- Remaining pairs in nativeReviewAudit.json: ${Object.values(auditPairsByLocale).reduce((a, b) => a + b, 0)}`);

    if (audit.staleEntries.length > 0) {
        console.log('Sample stale entries:');
        audit.staleEntries.slice(0, 10).forEach((e) => console.log(`  - [${e.locale}] ${e.id}: ${e.reason}`));
    }
    if (audit.invalidEntries.length > 0) {
        console.log('Sample invalid entries:');
        audit.invalidEntries.slice(0, 10).forEach((e) => console.log(`  - [${e.locale}] ${e.id}: ${e.reason}`));
    }

    if (args.check && (audit.staleEntries.length > 0 || audit.invalidEntries.length > 0)) {
        process.exitCode = 1;
    }
};

main();
