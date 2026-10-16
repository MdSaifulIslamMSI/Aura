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

// Walks the entry's transitive STATIC import closure, which is what the browser
// actually downloads before first paint. index.html alone is not that set: a
// chunk reachable only via `import ... from "./x.js"` still loads eagerly, and
// the entry can pull in eight route chunks that way (admin-*, commerce-flow,
// marketplace, product-experience, discovery) without index.html naming any of
// them. Reading only index.html reported 192.1 KB against a 470 KB cap while
// the real closure was 735.2 KB — the gate passed on a payload 56% over budget.
//
// Only static `from "..."` specifiers are followed. `import("...")` is a
// dynamic import and is deliberately excluded: those chunks are on-demand.
const STATIC_IMPORT_PATTERN = /import\s*[\{*A-Za-z0-9_$][^;]{0,400}?from\s*"\.\/([^"]+\.js)"/g;

const collectStaticClosure = (entryRelativePaths) => {
    const seen = new Set();
    const queue = [...entryRelativePaths];
    const closure = [];

    while (queue.length > 0) {
        const relativePath = queue.shift();
        if (seen.has(relativePath)) continue;
        const filePath = path.join(distDir, relativePath);
        if (!fs.existsSync(filePath)) continue;
        seen.add(relativePath);
        closure.push(relativePath);
        const content = fs.readFileSync(filePath, 'utf8');
        for (const match of content.matchAll(STATIC_IMPORT_PATTERN)) {
            const target = path.posix.join('assets', match[1]);
            if (!seen.has(target)) queue.push(target);
        }
    }

    return closure.sort();
};

const formatAssetName = (filePath) => path.relative(distDir, filePath).replace(/\\/g, '/');

try {
    assert(fs.existsSync(distDir), `Build output not found at ${distDir}. Run "npm run build" first.`);
    const assetsDir = path.join(distDir, 'assets');
    const jsAssets = readAssetSizes(listFiles(assetsDir, '.js'));
    const cssAssets = readAssetSizes(listFiles(assetsDir, '.css'));
    const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
    const initialAssets = parseInitialAssets(indexHtml);
    const initialJsAssets = initialAssets.filter((assetPath) => assetPath.endsWith('.js'));
    const initialCssAssets = initialAssets.filter((assetPath) => assetPath.endsWith('.css'));

    const resolveAssetGzipKb = (relativePath) => {
        const filePath = path.join(distDir, relativePath);
        if (!fs.existsSync(filePath)) return 0;
        return gzipKb(fs.readFileSync(filePath));
    };

    // Real first-load JS = the entry's static closure, not just what index.html
    // names. Tracked separately from maxTotalJsGzipKb so the existing eager-shell
    // budget keeps its meaning while the true closure is reported and gated on
    // its own ceiling.
    const staticClosure = collectStaticClosure(initialJsAssets);
    const staticClosureGzipKb = Number(staticClosure
        .reduce((sum, assetPath) => sum + resolveAssetGzipKb(assetPath), 0)
        .toFixed(2));
    const largestClosureAsset = staticClosure.reduce(
        (largest, assetPath) => (
            resolveAssetGzipKb(assetPath) > largest.gzipKb
                ? { file: assetPath, gzipKb: resolveAssetGzipKb(assetPath) }
                : largest
        ),
        { file: '', gzipKb: 0 }
    );

    // Treat the JS budget as "eager shell JS" so lazy route bundles do not
    // incorrectly count against first-load guardrails.
    const totalJsGzipKb = Number(initialJsAssets.reduce((sum, assetPath) => sum + resolveAssetGzipKb(assetPath), 0).toFixed(2));
    const allJsGzipKb = Number(jsAssets.reduce((sum, asset) => sum + asset.gzipKb, 0).toFixed(2));
    const lazyJsGzipKb = Number((allJsGzipKb - totalJsGzipKb).toFixed(2));
    const largestJsAsset = jsAssets.reduce(
        (largest, asset) => (asset.gzipKb > largest.gzipKb ? asset : largest),
        { file: '', gzipKb: 0 }
    );
    const totalCssGzipKb = Number(cssAssets.reduce((sum, asset) => sum + asset.gzipKb, 0).toFixed(2));
    const initialCssGzipKb = Number(initialCssAssets.reduce(
        (sum, assetPath) => sum + resolveAssetGzipKb(assetPath),
        0
    ).toFixed(2));
    const initialCssAssetSet = new Set(initialCssAssets);
    const lazyCssAssets = cssAssets.filter((asset) => !initialCssAssetSet.has(formatAssetName(asset.file)));
    const lazyCssGzipKb = Number(lazyCssAssets.reduce((sum, asset) => sum + asset.gzipKb, 0).toFixed(2));
    const largestLazyCssAsset = lazyCssAssets.reduce(
        (largest, asset) => (asset.gzipKb > largest.gzipKb ? asset : largest),
        { file: '', gzipKb: 0 }
    );
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
    if (initialCssGzipKb > budgets.bundle.maxInitialCssGzipKb) {
        violations.push(`initial css gzip ${initialCssGzipKb}kb > ${budgets.bundle.maxInitialCssGzipKb}kb`);
    }
    if (largestLazyCssAsset.gzipKb > budgets.bundle.maxLargestLazyCssGzipKb) {
        violations.push(`largest lazy css gzip ${largestLazyCssAsset.gzipKb}kb > ${budgets.bundle.maxLargestLazyCssGzipKb}kb`);
    }
    if (initialPayloadGzipKb > budgets.mobile.maxInitialPayloadGzipKb) {
        violations.push(`initial payload gzip ${initialPayloadGzipKb}kb > ${budgets.mobile.maxInitialPayloadGzipKb}kb`);
    }
    if (staticClosureGzipKb > budgets.bundle.maxFirstLoadJsGzipKb) {
        violations.push(
            `first-load js closure gzip ${staticClosureGzipKb}kb > ${budgets.bundle.maxFirstLoadJsGzipKb}kb `
            + `(${staticClosure.length} chunks reachable statically from the entry)`
        );
    }
    if (largestClosureAsset.gzipKb > budgets.bundle.maxLargestJsGzipKb) {
        violations.push(
            `largest first-load chunk ${largestClosureAsset.file} gzip ${largestClosureAsset.gzipKb}kb `
            + `> ${budgets.bundle.maxLargestJsGzipKb}kb`
        );
    }

    console.log(JSON.stringify({
        budgetsVersion: budgets.version,
        totalJsGzipKb,
        allJsGzipKb,
        lazyJsGzipKb,
        staticClosureChunkCount: staticClosure.length,
        staticClosureGzipKb,
        maxFirstLoadJsGzipKb: budgets.bundle.maxFirstLoadJsGzipKb,
        largestClosureAsset: largestClosureAsset.file
            ? formatAssetName(path.join(distDir, largestClosureAsset.file))
            : '',
        largestClosureGzipKb: largestClosureAsset.gzipKb,
        largestJsAsset: {
            file: largestJsAsset.file ? formatAssetName(largestJsAsset.file) : '',
            gzipKb: largestJsAsset.gzipKb,
        },
        totalCssGzipKb,
        initialCssGzipKb,
        lazyCssGzipKb,
        largestLazyCssAsset: {
            file: largestLazyCssAsset.file ? formatAssetName(largestLazyCssAsset.file) : '',
            gzipKb: largestLazyCssAsset.gzipKb,
        },
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
