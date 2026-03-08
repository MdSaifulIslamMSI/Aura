import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(appRoot, 'dist');
const budgetsPath = path.resolve(appRoot, '..', 'docs', 'performance-budgets.json');
const budgets = JSON.parse(fs.readFileSync(budgetsPath, 'utf8'));

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message);
    }
};

const gzipKb = (buffer) => Number((zlib.gzipSync(buffer).length / 1024).toFixed(2));

const listFiles = (dir, extension) => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter((entry) => entry.endsWith(extension))
        .map((entry) => path.join(dir, entry));
};

const readAssetSizes = (files) => files.map((filePath) => {
    const content = fs.readFileSync(filePath);
    return {
        file: filePath,
        gzipKb: gzipKb(content),
    };
});

const parseInitialAssets = (html) => {
    const matches = [...html.matchAll(/(?:src|href)="([^"]+assets\/[^"]+)"/g)];
    return [...new Set(matches.map((match) => match[1].replace(/^\//, '')))];
};

const formatAssetName = (filePath) => path.relative(distDir, filePath).replace(/\\/g, '/');

try {
    assert(fs.existsSync(distDir), `Build output not found at ${distDir}. Run "npm run build" first.`);
    const assetsDir = path.join(distDir, 'assets');
    const jsAssets = readAssetSizes(listFiles(assetsDir, '.js'));
    const cssAssets = readAssetSizes(listFiles(assetsDir, '.css'));
    const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
    const initialAssets = parseInitialAssets(indexHtml);

    const resolveAssetGzipKb = (relativePath) => {
        const filePath = path.join(distDir, relativePath);
        if (!fs.existsSync(filePath)) return 0;
        return gzipKb(fs.readFileSync(filePath));
    };

    const totalJsGzipKb = Number(jsAssets.reduce((sum, asset) => sum + asset.gzipKb, 0).toFixed(2));
    const largestJsAsset = jsAssets.reduce(
        (largest, asset) => (asset.gzipKb > largest.gzipKb ? asset : largest),
        { file: '', gzipKb: 0 }
    );
    const totalCssGzipKb = Number(cssAssets.reduce((sum, asset) => sum + asset.gzipKb, 0).toFixed(2));
    const initialPayloadGzipKb = Number(initialAssets.reduce((sum, assetPath) => sum + resolveAssetGzipKb(assetPath), 0).toFixed(2));

    const violations = [];

    if (totalJsGzipKb > budgets.bundle.maxTotalJsGzipKb) {
        violations.push(`total js gzip ${totalJsGzipKb}kb > ${budgets.bundle.maxTotalJsGzipKb}kb`);
    }
    if (largestJsAsset.gzipKb > budgets.bundle.maxLargestJsGzipKb) {
        violations.push(`largest js gzip ${largestJsAsset.gzipKb}kb > ${budgets.bundle.maxLargestJsGzipKb}kb`);
    }
    if (totalCssGzipKb > budgets.bundle.maxTotalCssGzipKb) {
        violations.push(`total css gzip ${totalCssGzipKb}kb > ${budgets.bundle.maxTotalCssGzipKb}kb`);
    }
    if (initialPayloadGzipKb > budgets.mobile.maxInitialPayloadGzipKb) {
        violations.push(`initial payload gzip ${initialPayloadGzipKb}kb > ${budgets.mobile.maxInitialPayloadGzipKb}kb`);
    }

    console.log(JSON.stringify({
        budgetsVersion: budgets.version,
        totalJsGzipKb,
        largestJsAsset: {
            file: largestJsAsset.file ? formatAssetName(largestJsAsset.file) : '',
            gzipKb: largestJsAsset.gzipKb,
        },
        totalCssGzipKb,
        initialPayloadGzipKb,
        note: `Manual mobile guardrails remain: maxInteractionBlockingMs=${budgets.mobile.maxInteractionBlockingMs}, minTapTargetPx=${budgets.mobile.minTapTargetPx}`,
    }, null, 2));

    if (violations.length > 0) {
        console.error(`Bundle budget failed:\n- ${violations.join('\n- ')}`);
        process.exitCode = 1;
    }
} catch (error) {
    console.error(`Bundle budget failed: ${error.message}`);
    process.exitCode = 1;
}
