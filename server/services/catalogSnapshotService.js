const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { z } = require('zod');
const AppError = require('../utils/AppError');
const { resolveCategory } = require('../config/categories');
const { auditCatalogSample } = require('./catalogSourceIntegrityService');

const SNAPSHOT_CACHE_DIR = path.resolve(
    process.cwd(),
    process.env.CATALOG_SNAPSHOT_CACHE_DIR || path.join(os.tmpdir(), 'aura-catalog-snapshots')
);
const ONBOARDING_SAMPLE_SIZE = Math.max(25, Number(process.env.CATALOG_ONBOARDING_SAMPLE_SIZE || 200));
const REQUIRED_CANONICAL_FIELDS = ['title', 'brand', 'category', 'price', 'description', 'image'];

const manifestSchema = z.object({
    providerName: z.string().trim().min(1).max(120),
    feedVersion: z.string().trim().min(1).max(120),
    exportTimestamp: z.string().trim().min(1).max(120),
    schemaVersion: z.string().trim().min(1).max(120),
    recordCount: z.coerce.number().int().positive(),
    sha256: z.string().trim().regex(/^[A-Fa-f0-9]{64}$/, 'sha256 must be a 64-character hex string'),
    sourceUrl: z.string().trim().url().optional(),
    sourceRef: z.string().trim().min(1).max(500).optional(),
    sourceType: z.enum(['json', 'jsonl', 'ndjson', 'csv']).optional(),
    fieldMapping: z.record(z.string(), z.string()).optional(),
    categoryMapping: z.record(z.string(), z.string()).optional(),
    imageHostAllowlist: z.array(z.string().trim().min(1).max(255)).max(100).optional(),
}).superRefine((value, ctx) => {
    if (!value.sourceUrl && !value.sourceRef) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Manifest must include sourceUrl or sourceRef',
            path: ['sourceRef'],
        });
    }
});

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const safeLower = (value, fallback = '') => safeString(value, fallback).toLowerCase();
const hashValue = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const isRemoteRef = (value = '') => /^https?:\/\//i.test(safeString(value));

const ensureCacheDir = async () => {
    await fs.promises.mkdir(SNAPSHOT_CACHE_DIR, { recursive: true });
};

const resolveLocalPath = (ref) => {
    const trimmed = safeString(ref);
    if (!trimmed) {
        throw new AppError('Snapshot reference is required', 400);
    }

    const candidatePaths = [
        trimmed,
        path.resolve(process.cwd(), trimmed),
        path.resolve(process.cwd(), 'data', trimmed),
        path.resolve(process.cwd(), '..', trimmed),
    ];

    for (const candidate of candidatePaths) {
        if (fs.existsSync(candidate)) {
            return path.resolve(candidate);
        }
    }

    throw new AppError(`Snapshot file not found: ${trimmed}`, 404);
};

const downloadRemoteResource = async (ref, label) => {
    await ensureCacheDir();

    const response = await fetch(ref);
    if (!response.ok) {
        throw new AppError(`Failed to download ${label}: ${response.status} ${response.statusText}`, 502);
    }

    const url = new URL(ref);
    const extension = path.extname(url.pathname) || (label === 'manifest' ? '.json' : '.bin');
    const fileName = `${label}_${hashValue(ref).slice(0, 20)}${extension}`;
    const targetPath = path.join(SNAPSHOT_CACHE_DIR, fileName);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.promises.writeFile(targetPath, buffer);

    return {
        ref,
        localPath: targetPath,
        remote: true,
    };
};

const resolveResource = async (ref, label) => {
    const normalizedRef = safeString(ref);
    if (!normalizedRef) {
        throw new AppError(`${label} reference is required`, 400);
    }

    if (isRemoteRef(normalizedRef)) {
        return downloadRemoteResource(normalizedRef, label);
    }

    return {
        ref: normalizedRef,
        localPath: resolveLocalPath(normalizedRef),
        remote: false,
    };
};

const parseCsvLine = (line) => {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const next = line[index + 1];

        if (char === '"' && inQuotes && next === '"') {
            current += '"';
            index += 1;
            continue;
        }

        if (char === '"') {
            inQuotes = !inQuotes;
            continue;
        }

        if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    values.push(current.trim());
    return values;
};

const sampleRowsFromFile = async ({ sourceType, filePath, sampleSize = ONBOARDING_SAMPLE_SIZE }) => {
    const normalizedType = safeLower(sourceType || path.extname(filePath).replace('.', ''), 'jsonl');
    const sample = [];

    if (['jsonl', 'ndjson'].includes(normalizedType)) {
        const rl = readline.createInterface({
            input: fs.createReadStream(filePath, { encoding: 'utf8' }),
            crlfDelay: Infinity,
        });

        for await (const line of rl) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                sample.push(JSON.parse(trimmed));
            } catch {
                continue;
            }
            if (sample.length >= sampleSize) break;
        }
        return sample;
    }

    if (normalizedType === 'csv') {
        const rl = readline.createInterface({
            input: fs.createReadStream(filePath, { encoding: 'utf8' }),
            crlfDelay: Infinity,
        });
        let headers = null;

        for await (const line of rl) {
            if (!line.trim()) continue;
            if (!headers) {
                headers = parseCsvLine(line).map((entry) => safeString(entry));
                continue;
            }
            const values = parseCsvLine(line);
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index] ?? '';
            });
            sample.push(row);
            if (sample.length >= sampleSize) break;
        }
        return sample;
    }

    if (normalizedType === 'json') {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : []);
        return rows.slice(0, sampleSize);
    }

    throw new AppError(`Unsupported snapshot sourceType: ${normalizedType}`, 400);
};

const computeFileSha256 = async (filePath) => new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
});

const toHost = (value) => {
    const raw = safeString(value);
    if (!raw) return '';

    try {
        return new URL(raw).hostname.toLowerCase();
    } catch {
        return '';
    }
};

const canonicalValue = (row = {}, canonicalField, fieldMapping = {}) => {
    const explicitKey = safeString(fieldMapping?.[canonicalField]);
    if (explicitKey && row[explicitKey] !== undefined) {
        return row[explicitKey];
    }

    const aliases = {
        title: ['title', 'name', 'productName'],
        brand: ['brand', 'manufacturer'],
        category: ['category', 'subCategory', 'department'],
        price: ['price', 'mrp', 'salePrice'],
        description: ['description', 'summary'],
        image: ['image', 'thumbnail', 'imageUrl'],
    }[canonicalField] || [canonicalField];

    return aliases.find((key) => row[key] !== undefined) ? row[aliases.find((key) => row[key] !== undefined)] : undefined;
};

const buildFieldCoverage = (sampleRows = [], manifest = {}) => {
    const fieldMapping = manifest.fieldMapping || {};
    const coverage = {};

    REQUIRED_CANONICAL_FIELDS.forEach((field) => {
        const presentCount = sampleRows.filter((row) => safeString(canonicalValue(row, field, fieldMapping))).length;
        coverage[field] = {
            mappedFrom: safeString(fieldMapping[field]) || null,
            presentCount,
            presentRatio: sampleRows.length > 0 ? Number((presentCount / sampleRows.length).toFixed(3)) : 0,
        };
    });

    return coverage;
};

const buildCategoryReview = (sampleRows = [], manifest = {}) => {
    const fieldMapping = manifest.fieldMapping || {};
    const manifestCategoryMapping = manifest.categoryMapping || {};
    const categories = [...new Set(sampleRows
        .map((row) => safeString(canonicalValue(row, 'category', fieldMapping)))
        .filter(Boolean))]
        .slice(0, 30);

    return {
        sampleCategories: categories,
        unresolved: categories.filter((category) => {
            const manifestMapped = safeString(manifestCategoryMapping[category]);
            return !manifestMapped && !resolveCategory(category);
        }),
    };
};

const buildImageHostReview = (sampleRows = [], manifest = {}) => {
    const fieldMapping = manifest.fieldMapping || {};
    const allowlist = new Set((manifest.imageHostAllowlist || []).map((entry) => safeLower(entry)));
    const hostCounts = new Map();

    sampleRows.forEach((row) => {
        const host = toHost(canonicalValue(row, 'image', fieldMapping));
        if (!host) return;
        hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
    });

    const hosts = [...hostCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([host, count]) => ({
            host,
            count,
            allowlisted: allowlist.size === 0 ? null : allowlist.has(host),
        }));

    return {
        hosts,
        unknownHosts: hosts.filter((entry) => entry.allowlisted === false).map((entry) => entry.host),
    };
};

const parseManifest = async (manifestRef, sourceRef) => {
    const resolvedManifestRef = safeString(manifestRef || `${safeString(sourceRef)}.manifest.json`);
    const manifestResource = await resolveResource(resolvedManifestRef, 'manifest');
    const raw = await fs.promises.readFile(manifestResource.localPath, 'utf8');

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new AppError(`Invalid snapshot manifest JSON: ${error.message}`, 400);
    }

    const parsedManifest = manifestSchema.safeParse(parsed);
    if (!parsedManifest.success) {
        const message = parsedManifest.error.issues
            .map((issue) => issue.message)
            .filter(Boolean)
            .join('; ');
        throw new AppError(`Invalid snapshot manifest: ${message || 'schema validation failed'}`, 400);
    }

    const manifest = parsedManifest.data;
    return {
        manifest,
        manifestResource,
    };
};

const inspectCatalogSnapshot = async ({
    sourceType,
    sourceRef,
    manifestRef,
    sampleSize = ONBOARDING_SAMPLE_SIZE,
}) => {
    const sourceResource = await resolveResource(sourceRef, 'snapshot');
    const { manifest, manifestResource } = await parseManifest(manifestRef, sourceRef);
    const effectiveSourceType = safeLower(sourceType || manifest.sourceType || path.extname(sourceResource.localPath).replace('.', ''), 'jsonl');
    const checksum = await computeFileSha256(sourceResource.localPath);
    const sampleRows = await sampleRowsFromFile({
        sourceType: effectiveSourceType,
        filePath: sourceResource.localPath,
        sampleSize,
    });
    const audit = auditCatalogSample(sampleRows);
    const fieldCoverage = buildFieldCoverage(sampleRows, manifest);
    const categoryReview = buildCategoryReview(sampleRows, manifest);
    const imageHostReview = buildImageHostReview(sampleRows, manifest);

    const manifestSourceRef = safeString(manifest.sourceRef || manifest.sourceUrl);
    const manifestMatchesSource = !manifestSourceRef || manifestSourceRef === safeString(sourceRef);
    const checksumMatches = checksum.toLowerCase() === safeLower(manifest.sha256);
    const missingFieldCoverage = REQUIRED_CANONICAL_FIELDS.filter((field) => fieldCoverage[field].presentRatio < 0.8);
    const readyForImport = manifestMatchesSource
        && checksumMatches
        && !audit.looksSyntheticDataset
        && missingFieldCoverage.length === 0
        && categoryReview.unresolved.length === 0
        && imageHostReview.unknownHosts.length === 0;

    return {
        sourceType: effectiveSourceType,
        sourceRef: safeString(sourceRef),
        sourceResource,
        manifestRef: manifestResource.ref,
        manifestResource,
        manifest: {
            providerName: manifest.providerName,
            feedVersion: manifest.feedVersion,
            exportTimestamp: manifest.exportTimestamp,
            schemaVersion: manifest.schemaVersion,
            recordCount: manifest.recordCount,
            sha256: manifest.sha256,
            sourceUrl: manifest.sourceUrl || '',
            sourceRef: manifest.sourceRef || '',
            sourceType: manifest.sourceType || effectiveSourceType,
            fieldMapping: manifest.fieldMapping || {},
            categoryMapping: manifest.categoryMapping || {},
            imageHostAllowlist: manifest.imageHostAllowlist || [],
        },
        validation: {
            readyForImport,
            manifestMatchesSource,
            checksumMatches,
            computedSha256: checksum,
            sampleSize: sampleRows.length,
            missingFieldCoverage,
            checkedAt: new Date().toISOString(),
        },
        audit,
        fieldCoverage,
        categoryReview,
        imageHostReview,
    };
};

const prepareCatalogSnapshotForImport = async (input = {}) => {
    const report = await inspectCatalogSnapshot(input);

    if (!report.validation.manifestMatchesSource) {
        throw new AppError('Snapshot manifest sourceRef/sourceUrl does not match requested sourceRef', 409);
    }
    if (!report.validation.checksumMatches) {
        throw new AppError('Snapshot manifest SHA-256 does not match the source snapshot', 409);
    }
    if (!report.validation.readyForImport) {
        throw new AppError('Snapshot onboarding validation failed. Resolve field coverage, category mapping, image host trust, or synthetic data issues first.', 409);
    }

    return report;
};

module.exports = {
    inspectCatalogSnapshot,
    prepareCatalogSnapshotForImport,
};
