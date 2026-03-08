const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const AppError = require('../utils/AppError');
const Product = require('../models/Product');
const { resolveCategory } = require('../config/categories');
const { isWeakImageUrl } = require('./productImageResolver');
const { canonicalizeProductImageUrl } = require('./productImageResolver');

const DEFAULT_OUTPUT_ROOT = path.resolve(
    process.cwd(),
    process.env.KAGGLE_CATALOG_OUTPUT_DIR || path.join('generated', 'catalog', 'kaggle')
);
const DEFAULT_CACHE_ROOT = path.resolve(
    process.cwd(),
    process.env.KAGGLE_CACHE_DIR || path.join('.cache', 'kaggle')
);
const SUPPORTED_DATA_FILE_EXTENSIONS = new Set(['.csv', '.json', '.jsonl', '.ndjson']);
const CORE_FIELD_ALIASES = {
    id: ['id', 'product_id', 'productid', 'sku', 'asin', 'uniq_id'],
    title: ['title', 'name', 'product_name', 'productname', 'product', 'product_title'],
    brand: ['brand', 'manufacturer', 'company', 'product_brand'],
    category: ['category', 'sub_category', 'subcategory', 'department', 'product_category', 'main_category', 'product_category_tree', 'product_category'],
    price: ['price', 'sale_price', 'selling_price', 'discount_price', 'discounted_price', 'final_price', 'retail_price', 'mrp'],
    originalPrice: ['original_price', 'actual_price', 'list_price', 'mrp', 'retail_price', 'original_price'],
    rating: ['rating', 'stars', 'review_score', 'average_rating', 'product_rating'],
    ratingCount: ['rating_count', 'ratings_count', 'review_count', 'reviews', 'num_reviews', 'total_reviews'],
    stock: ['stock', 'quantity', 'qty', 'inventory', 'available_quantity'],
    description: ['description', 'about_product', 'summary', 'product_description', 'details'],
    image: ['image', 'image_url', 'img_link', 'thumbnail', 'imageurl', 'product_image', 'primary_image', 'product_image_url', 'imgUrl'],
    highlights: ['highlights', 'bullet_points', 'features', 'key_features'],
    warranty: ['warranty', 'warranty_info'],
};

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const safeLower = (value, fallback = '') => safeString(value, fallback).toLowerCase();
const hashValue = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const normalizeTitleKey = (value) => (typeof Product.normalizeTitleKey === 'function'
    ? Product.normalizeTitleKey(value)
    : safeLower(String(value || '').replace(/\s+/g, ' ').trim()));
const normalizeImageKey = (value) => (typeof Product.normalizeImageKey === 'function'
    ? Product.normalizeImageKey(value)
    : safeLower(String(value || '').trim()));

const ensureDir = async (targetPath) => {
    await fs.promises.mkdir(targetPath, { recursive: true });
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

const slugifyDataset = (dataset) => safeLower(dataset)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const escapePowerShell = (value) => String(value || '').replace(/'/g, "''");

const runCommand = ({ command, args, cwd }) => {
    const result = spawnSync(command, args, {
        cwd,
        env: process.env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (result.error) {
        throw new AppError(`Command failed: ${command} (${result.error.message})`, 500);
    }

    if (result.status !== 0) {
        const stderr = safeString(result.stderr || result.stdout || '');
        throw new AppError(stderr || `Command failed: ${command}`, 500);
    }

    return result.stdout || '';
};

const resolveLatestZip = async (directoryPath) => {
    const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
    const zipCandidates = await Promise.all(entries
        .filter((entry) => entry.isFile() && safeLower(path.extname(entry.name)) === '.zip')
        .map(async (entry) => {
            const filePath = path.join(directoryPath, entry.name);
            const stats = await fs.promises.stat(filePath);
            return {
                filePath,
                modifiedAt: stats.mtimeMs,
                size: stats.size,
            };
        }));

    zipCandidates.sort((lhs, rhs) => rhs.modifiedAt - lhs.modifiedAt || rhs.size - lhs.size);
    return zipCandidates[0]?.filePath || '';
};

const downloadKaggleArchive = async ({
    dataset,
    cacheRoot = DEFAULT_CACHE_ROOT,
    force = false,
}) => {
    const normalizedDataset = safeString(dataset);
    if (!normalizedDataset) {
        throw new AppError('Kaggle dataset slug is required (owner/dataset)', 400);
    }

    const datasetKey = slugifyDataset(normalizedDataset);
    const targetDir = path.join(cacheRoot, datasetKey, 'download');
    await ensureDir(targetDir);

    const latestZip = !force ? await resolveLatestZip(targetDir) : '';
    if (latestZip) {
        return {
            archivePath: latestZip,
            dataset: normalizedDataset,
            datasetKey,
            downloaded: false,
        };
    }

    try {
        runCommand({
            command: process.env.KAGGLE_BIN || 'kaggle',
            args: ['datasets', 'download', '-d', normalizedDataset, '-p', targetDir, '--force'],
            cwd: targetDir,
        });
    } catch (error) {
        const message = safeString(error.message || '');
        const authBlocked = /authenticate|forbidden|403/i.test(message);
        throw new AppError(
            authBlocked
                ? `Kaggle CLI download failed because this machine is not authenticated with Kaggle yet. Configure kaggle.json or KAGGLE_USERNAME/KAGGLE_KEY and retry. ${message}`.trim()
                : `Kaggle CLI download failed. Install the official Kaggle API CLI, configure credentials, and retry. ${message}`.trim(),
            500
        );
    }

    const archivePath = await resolveLatestZip(targetDir);
    if (!archivePath) {
        throw new AppError('Kaggle dataset download completed without a zip archive', 500);
    }

    return {
        archivePath,
        dataset: normalizedDataset,
        datasetKey,
        downloaded: true,
    };
};

const extractArchive = async ({
    archivePath,
    extractRoot = DEFAULT_CACHE_ROOT,
    datasetKey,
    force = false,
}) => {
    const normalizedArchive = path.resolve(archivePath);
    const effectiveDatasetKey = safeString(datasetKey || path.basename(normalizedArchive, path.extname(normalizedArchive)));
    const targetDir = path.join(extractRoot, effectiveDatasetKey, 'extracted');
    const markerPath = path.join(targetDir, '.complete');

    if (!force && fs.existsSync(markerPath)) {
        return {
            extractDir: targetDir,
            extracted: false,
        };
    }

    await fs.promises.rm(targetDir, { recursive: true, force: true });
    await ensureDir(targetDir);

    if (process.platform === 'win32') {
        runCommand({
            command: 'powershell',
            args: [
                '-NoProfile',
                '-Command',
                `Expand-Archive -Path '${escapePowerShell(normalizedArchive)}' -DestinationPath '${escapePowerShell(targetDir)}' -Force`,
            ],
            cwd: targetDir,
        });
    } else {
        runCommand({
            command: 'unzip',
            args: ['-o', normalizedArchive, '-d', targetDir],
            cwd: targetDir,
        });
    }

    await fs.promises.writeFile(markerPath, new Date().toISOString(), 'utf8');
    return {
        extractDir: targetDir,
        extracted: true,
    };
};

const collectFilesRecursive = async (rootPath) => {
    const output = [];
    const walk = async (currentPath) => {
        const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
        await Promise.all(entries.map(async (entry) => {
            const entryPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                await walk(entryPath);
                return;
            }
            output.push(entryPath);
        }));
    };

    await walk(rootPath);
    return output;
};

const selectDatasetFile = async ({
    extractDir,
    datasetFile = '',
}) => {
    const files = await collectFilesRecursive(extractDir);
    const supportedFiles = await Promise.all(files
        .filter((filePath) => SUPPORTED_DATA_FILE_EXTENSIONS.has(safeLower(path.extname(filePath))))
        .map(async (filePath) => ({
            filePath,
            relativePath: path.relative(extractDir, filePath),
            stats: await fs.promises.stat(filePath),
        })));

    if (supportedFiles.length === 0) {
        throw new AppError('No supported CSV/JSON/JSONL data file found in Kaggle dataset archive', 400);
    }

    const explicit = safeLower(datasetFile);
    if (explicit) {
        const match = supportedFiles.find((entry) => safeLower(entry.relativePath) === explicit || safeLower(path.basename(entry.filePath)) === explicit);
        if (!match) {
            throw new AppError(`Kaggle dataset file not found in archive: ${datasetFile}`, 404);
        }
        return match.filePath;
    }

    supportedFiles.sort((lhs, rhs) => rhs.stats.size - lhs.stats.size || lhs.relativePath.localeCompare(rhs.relativePath));
    return supportedFiles[0].filePath;
};

async function* streamRowsFromFile(dataFilePath) {
    const extension = safeLower(path.extname(dataFilePath));

    if (extension === '.csv') {
        const rl = readline.createInterface({
            input: fs.createReadStream(dataFilePath, { encoding: 'utf8' }),
            crlfDelay: Infinity,
        });
        let headers = null;
        let rowNumber = 0;

        for await (const line of rl) {
            if (!line.trim()) continue;
            rowNumber += 1;
            if (!headers) {
                headers = parseCsvLine(line).map((entry) => safeString(entry));
                continue;
            }

            const values = parseCsvLine(line);
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index] ?? '';
            });
            yield { rowNumber, row };
        }
        return;
    }

    if (extension === '.jsonl' || extension === '.ndjson') {
        const rl = readline.createInterface({
            input: fs.createReadStream(dataFilePath, { encoding: 'utf8' }),
            crlfDelay: Infinity,
        });
        let rowNumber = 0;

        for await (const line of rl) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            rowNumber += 1;
            yield { rowNumber, row: JSON.parse(trimmed) };
        }
        return;
    }

    if (extension === '.json') {
        const raw = await fs.promises.readFile(dataFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : []);
        rows.forEach((row, index) => {
            rows[index] = { rowNumber: index + 1, row };
        });
        for (const entry of rows) {
            yield entry;
        }
        return;
    }

    throw new AppError(`Unsupported Kaggle dataset file type: ${extension}`, 400);
}

const resolveFieldValue = (row, fieldName, fieldMapping = {}) => {
    const explicitField = safeString(fieldMapping[fieldName]);
    const candidates = explicitField
        ? [explicitField]
        : (CORE_FIELD_ALIASES[fieldName] || [fieldName]);

    for (const candidate of candidates) {
        if (Object.prototype.hasOwnProperty.call(row, candidate)) {
            return { value: row[candidate], sourceField: candidate };
        }

        const matchedKey = Object.keys(row).find((key) => safeLower(key) === safeLower(candidate));
        if (matchedKey) {
            return { value: row[matchedKey], sourceField: matchedKey };
        }
    }

    return { value: undefined, sourceField: explicitField || '' };
};

const parseNumericValue = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = safeString(value);
    if (!raw) return NaN;
    if (/no rating available/i.test(raw)) return NaN;
    const normalized = raw.replace(/[^0-9.\-]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
};

const parsePossibleArray = (value) => {
    const raw = safeString(value);
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const inferBrandFromTitle = (title) => {
    const raw = safeString(title);
    if (!raw) return '';
    const prefix = raw.split(/[\s,|(/-]+/).filter(Boolean).slice(0, 2).join(' ');
    return safeString(prefix);
};

const normalizeCategoryFromTree = (value, title = '') => {
    const raw = safeString(value);
    if (!raw) return '';

    const parsedArray = parsePossibleArray(raw);
    const primary = safeString(parsedArray[0] || raw)
        .replace(/\.\.\./g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const lower = safeLower(primary);

    if (lower.includes("women")) return "Women's Fashion";
    if (lower.includes("men")) return "Men's Fashion";
    if (lower.includes('footwear') || lower.includes('shoe') || lower.includes('sandal') || lower.includes('bellies')) return 'Footwear';
    if (lower.includes('furniture') || lower.includes('kitchen') || lower.includes('home')) return 'Home & Kitchen';
    if (lower.includes('book')) return 'Books';
    if (lower.includes('laptop') || lower.includes('notebook')) return 'Laptops';
    if (lower.includes('mobile') || lower.includes('smartphone') || lower.includes('phone')) return 'Mobiles';
    if (lower.includes('gaming')) return 'Gaming & Accessories';
    if (lower.includes('electronics') || lower.includes('camera') || lower.includes('audio') || lower.includes('computer')) return 'Electronics';

    const parts = primary.split('>>').map((entry) => safeString(entry)).filter(Boolean);
    const filtered = parts.filter((entry) => safeLower(entry) !== safeLower(title));
    return safeString(filtered[0] || parts[0] || primary);
};

const toHighlights = (value) => {
    if (Array.isArray(value)) {
        return value.map((entry) => safeString(entry)).filter(Boolean).slice(0, 8);
    }

    const raw = safeString(value);
    if (!raw) return [];
    return raw
        .split(/\r?\n|[|;]+/g)
        .map((entry) => safeString(entry))
        .filter(Boolean)
        .slice(0, 8);
};

const toImageUrl = (value, imageBaseUrl = '') => {
    const raw = safeString(value);
    if (!raw) return '';
    const parsedArray = parsePossibleArray(raw);
    if (parsedArray.length > 0) {
        const firstUrl = parsedArray.map((entry) => safeString(entry)).find((entry) => /^https?:\/\//i.test(entry));
        if (firstUrl) return canonicalizeProductImageUrl(firstUrl);
    }
    if (/^https?:\/\//i.test(raw)) return canonicalizeProductImageUrl(raw);
    if (!imageBaseUrl) return '';

    const normalizedBase = imageBaseUrl.endsWith('/') ? imageBaseUrl : `${imageBaseUrl}/`;
    try {
        return canonicalizeProductImageUrl(new URL(raw.replace(/^\.?\//, ''), normalizedBase).toString());
    } catch {
        return '';
    }
};

const hostFromUrl = (value) => {
    try {
        return new URL(String(value || '').trim()).hostname.toLowerCase();
    } catch {
        return '';
    }
};

const buildSpecifications = ({
    row,
    fieldMapping = {},
    usedSourceFields = new Set(),
    specFields = [],
}) => {
    const output = [];
    const explicitFields = Array.isArray(specFields)
        ? specFields.map((entry) => safeString(entry)).filter(Boolean)
        : [];

    const candidateFields = explicitFields.length > 0
        ? explicitFields
        : Object.keys(row).filter((key) => !usedSourceFields.has(key));

    for (const sourceField of candidateFields) {
        if (output.length >= 8) break;
        const { value, sourceField: actualField } = resolveFieldValue(row, sourceField, explicitFields.length > 0 ? {} : fieldMapping);
        const key = safeString(actualField || sourceField);
        const normalizedValue = safeString(value);
        if (!key || !normalizedValue) continue;
        if (normalizedValue.length > 220) continue;
        output.push({
            key: key.slice(0, 80),
            value: normalizedValue.slice(0, 220),
        });
    }

    return output;
};

const parseSpecificationBlob = (value) => {
    const raw = safeString(value);
    if (!raw) return [];

    const output = [];
    const pairPattern = /"key"\s*=>\s*"([^"]+)"\s*,\s*"value"\s*=>\s*"([^"]*)"/g;
    let match;
    while ((match = pairPattern.exec(raw)) !== null) {
        const key = safeString(match[1]);
        const specValue = safeString(match[2]);
        if (!key || !specValue) continue;
        output.push({
            key: key.slice(0, 80),
            value: specValue.slice(0, 220),
        });
        if (output.length >= 12) break;
    }

    return output;
};

const buildCanonicalRecord = ({
    row,
    rowNumber,
    fieldMapping = {},
    imageBaseUrl = '',
    specFields = [],
    strict = true,
    resolvedFieldMap = {},
}) => {
    const usedSourceFields = new Set();
    const remember = (fieldName, result) => {
        if (result.sourceField) {
            resolvedFieldMap[fieldName] = resolvedFieldMap[fieldName] || result.sourceField;
            usedSourceFields.add(result.sourceField);
        }
        return result.value;
    };

    const title = safeString(remember('title', resolveFieldValue(row, 'title', fieldMapping)));
    const rawBrand = safeString(remember('brand', resolveFieldValue(row, 'brand', fieldMapping)));
    const brand = rawBrand || inferBrandFromTitle(title);
    const rawCategoryValue = safeString(remember('category', resolveFieldValue(row, 'category', fieldMapping)));
    const price = parseNumericValue(remember('price', resolveFieldValue(row, 'price', fieldMapping)));
    const originalPriceRaw = parseNumericValue(remember('originalPrice', resolveFieldValue(row, 'originalPrice', fieldMapping)));
    const rating = parseNumericValue(remember('rating', resolveFieldValue(row, 'rating', fieldMapping)));
    const ratingCount = parseNumericValue(remember('ratingCount', resolveFieldValue(row, 'ratingCount', fieldMapping)));
    const stock = parseNumericValue(remember('stock', resolveFieldValue(row, 'stock', fieldMapping)));
    const description = safeString(remember('description', resolveFieldValue(row, 'description', fieldMapping)));
    const image = toImageUrl(remember('image', resolveFieldValue(row, 'image', fieldMapping)), imageBaseUrl);
    const highlights = toHighlights(remember('highlights', resolveFieldValue(row, 'highlights', fieldMapping)));
    const warranty = safeString(remember('warranty', resolveFieldValue(row, 'warranty', fieldMapping)));
    const externalIdRaw = safeString(remember('id', resolveFieldValue(row, 'id', fieldMapping)));
    const derivedCategory = normalizeCategoryFromTree(rawCategoryValue, title);
    const category = safeString(resolveCategory(derivedCategory) || derivedCategory);

    if (!title) return { skipReason: 'missing_title', rowNumber };
    if (!brand) return { skipReason: 'missing_brand', rowNumber };
    if (!category) return { skipReason: 'missing_category', rowNumber };
    if (!Number.isFinite(price) || price < 0) return { skipReason: 'missing_price', rowNumber };
    if (!description || description.length < 40) return { skipReason: 'missing_description', rowNumber };
    if (!image || isWeakImageUrl(image)) return { skipReason: 'missing_real_image', rowNumber };

    const specifications = buildSpecifications({
        row,
        fieldMapping,
        usedSourceFields,
        specFields,
    });
    const blobSpecifications = parseSpecificationBlob(safeString(row.product_specifications));
    const mergedSpecifications = [...specifications, ...blobSpecifications]
        .filter((entry, index, array) => {
            const signature = `${safeLower(entry?.key)}|${safeLower(entry?.value)}`;
            return signature !== '|' && array.findIndex((candidate) => `${safeLower(candidate?.key)}|${safeLower(candidate?.value)}` === signature) === index;
        })
        .slice(0, 12);

    if (strict && mergedSpecifications.length < 2) {
        return { skipReason: 'missing_specifications', rowNumber };
    }

    const originalPrice = Number.isFinite(originalPriceRaw) && originalPriceRaw >= price
        ? originalPriceRaw
        : price;
    const discountPercentage = originalPrice > price
        ? Number((((originalPrice - price) / originalPrice) * 100).toFixed(2))
        : 0;
    const externalId = externalIdRaw || hashValue(`${title}|${brand}|${category}|${price}`).slice(0, 24);

    return {
        record: {
            externalId,
            title,
            brand,
            category,
            price: Number(price.toFixed(2)),
            originalPrice: Number(originalPrice.toFixed(2)),
            discountPercentage,
            rating: Number.isFinite(rating) ? Number(Math.min(Math.max(rating, 0), 5).toFixed(1)) : 0,
            ratingCount: Number.isFinite(ratingCount) ? Math.max(0, Math.trunc(ratingCount)) : 0,
            stock: Number.isFinite(stock) ? Math.max(0, Math.trunc(stock)) : 0,
            description,
            image,
            highlights,
            specifications: mergedSpecifications,
            warranty,
            deliveryTime: '3-5 days',
        },
    };
};

const computeFileSha256 = async (filePath) => new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
});

const prepareKaggleCatalogSnapshotFromFile = async ({
    dataset,
    dataFilePath,
    outputRoot = DEFAULT_OUTPUT_ROOT,
    limit = 0,
    fieldMapping = {},
    imageBaseUrl = '',
    specFields = [],
    strict = true,
    providerName = '',
}) => {
    const normalizedDataset = safeString(dataset || 'kaggle-dataset');
    const datasetKey = slugifyDataset(normalizedDataset);
    const timestamp = Date.now();
    const targetDir = path.join(outputRoot, datasetKey);
    await ensureDir(targetDir);

    const snapshotPath = path.join(targetDir, `${datasetKey}_${timestamp}.jsonl`);
    const manifestPath = `${snapshotPath}.manifest.json`;
    const snapshotWriter = fs.createWriteStream(snapshotPath, { encoding: 'utf8' });
    const stats = {
        processedRows: 0,
        writtenRows: 0,
        duplicateRows: 0,
        skippedRows: 0,
        skipReasons: {},
    };
    const seenFingerprints = new Set();
    const seenTitleKeys = new Set();
    const seenImageKeys = new Set();
    const seenExternalIds = new Set();
    const resolvedFieldMap = {};
    const imageHosts = new Set();
    const categoryMappings = new Map();

    try {
        for await (const { rowNumber, row } of streamRowsFromFile(dataFilePath)) {
            stats.processedRows += 1;

            const normalized = buildCanonicalRecord({
                row,
                rowNumber,
                fieldMapping,
                imageBaseUrl,
                specFields,
                strict,
                resolvedFieldMap,
            });

            if (!normalized.record) {
                stats.skippedRows += 1;
                const reason = safeString(normalized.skipReason || 'invalid_row');
                stats.skipReasons[reason] = (stats.skipReasons[reason] || 0) + 1;
                continue;
            }

            const record = normalized.record;
            const fingerprint = hashValue([
                normalizeTitleKey(record.title),
                normalizeTitleKey(record.brand),
                normalizeTitleKey(record.category),
                Number(record.price).toFixed(2),
                normalizeImageKey(record.image),
            ].join('|'));
            const titleKey = normalizeTitleKey(record.title);
            const imageKey = normalizeImageKey(record.image);

            if (
                seenFingerprints.has(fingerprint)
                || seenTitleKeys.has(titleKey)
                || seenImageKeys.has(imageKey)
                || seenExternalIds.has(record.externalId)
            ) {
                stats.duplicateRows += 1;
                stats.skipReasons.duplicate_identity = (stats.skipReasons.duplicate_identity || 0) + 1;
                continue;
            }

            seenFingerprints.add(fingerprint);
            seenTitleKeys.add(titleKey);
            seenImageKeys.add(imageKey);
            seenExternalIds.add(record.externalId);
            const host = hostFromUrl(record.image);
            if (host) imageHosts.add(host);
            if (record.category) {
                categoryMappings.set(record.category, resolveCategory(record.category) || record.category);
            }

            snapshotWriter.write(`${JSON.stringify(record)}${os.EOL}`);
            stats.writtenRows += 1;

            if (limit > 0 && stats.writtenRows >= limit) {
                break;
            }
        }
    } finally {
        await new Promise((resolve) => snapshotWriter.end(resolve));
    }

    if (stats.writtenRows === 0) {
        throw new AppError('Kaggle dataset produced zero strict importable product rows', 409);
    }

    const snapshotSha256 = await computeFileSha256(snapshotPath);
    const datasetUrl = `https://www.kaggle.com/datasets/${normalizedDataset}`;
    const manifest = {
        providerName: safeString(providerName || `Kaggle ${normalizedDataset}`),
        feedVersion: `kaggle-${datasetKey}-${timestamp}`,
        exportTimestamp: new Date(timestamp).toISOString(),
        schemaVersion: '2026-03-kaggle-v1',
        recordCount: stats.writtenRows,
        sha256: snapshotSha256,
        sourceUrl: datasetUrl,
        sourceRef: snapshotPath,
        sourceType: 'jsonl',
        fieldMapping: resolvedFieldMap,
        categoryMapping: Object.fromEntries([...categoryMappings.entries()].sort(([left], [right]) => left.localeCompare(right))),
        imageHostAllowlist: [...imageHosts].sort(),
    };

    await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    return {
        dataset: normalizedDataset,
        dataFilePath,
        snapshotPath,
        manifestPath,
        manifest,
        stats,
    };
};

const prepareKaggleCatalogSnapshot = async ({
    dataset,
    datasetFile = '',
    sourceFile = '',
    archivePath = '',
    outputRoot = DEFAULT_OUTPUT_ROOT,
    cacheRoot = DEFAULT_CACHE_ROOT,
    extractRoot = DEFAULT_CACHE_ROOT,
    limit = 0,
    fieldMapping = {},
    imageBaseUrl = '',
    specFields = [],
    strict = true,
    force = false,
    providerName = '',
}) => {
    const normalizedSourceFile = safeString(sourceFile);
    let dataFilePath = normalizedSourceFile ? path.resolve(normalizedSourceFile) : '';
    let normalizedDataset = safeString(dataset);
    let datasetKey = slugifyDataset(normalizedDataset || path.basename(dataFilePath, path.extname(dataFilePath)));

    if (!dataFilePath) {
        let resolvedArchivePath = safeString(archivePath);

        if (!resolvedArchivePath) {
            const download = await downloadKaggleArchive({
                dataset: normalizedDataset,
                cacheRoot,
                force,
            });
            resolvedArchivePath = download.archivePath;
            normalizedDataset = download.dataset;
            datasetKey = download.datasetKey;
        }

        const extracted = await extractArchive({
            archivePath: resolvedArchivePath,
            extractRoot,
            datasetKey,
            force,
        });

        dataFilePath = await selectDatasetFile({
            extractDir: extracted.extractDir,
            datasetFile,
        });
    }

    return prepareKaggleCatalogSnapshotFromFile({
        dataset: normalizedDataset || datasetKey || 'kaggle-dataset',
        dataFilePath,
        outputRoot,
        limit,
        fieldMapping,
        imageBaseUrl,
        specFields,
        strict,
        providerName,
    });
};

module.exports = {
    prepareKaggleCatalogSnapshot,
    prepareKaggleCatalogSnapshotFromFile,
};
