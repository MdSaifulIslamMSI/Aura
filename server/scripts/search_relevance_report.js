const {
    DEFAULT_CORPUS_PATH,
    REPORT_PATH,
    loadSeededSearchCorpus,
    writeLatestSearchRelevanceReport,
} = require('../services/searchRelevanceService');

const parseArgs = () => process.argv.slice(2).reduce((acc, arg) => {
    if (!arg.startsWith('--')) return acc;
    const [rawKey, ...rawValue] = arg.slice(2).split('=');
    acc[rawKey] = rawValue.length > 0 ? rawValue.join('=') : 'true';
    return acc;
}, {});

const args = parseArgs();

const baseUrl = String(args['base-url'] || process.env.SEARCH_REPORT_BASE_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');
const corpusPath = String(args.corpus || process.env.SEARCH_REPORT_CORPUS || DEFAULT_CORPUS_PATH);
const reportPath = String(args.report || process.env.SEARCH_REPORT_OUTPUT || REPORT_PATH);
const minAverageScore = Number(args['min-average-score'] || process.env.SEARCH_REPORT_MIN_AVG_SCORE || 65);
const maxZeroResultRate = Number(args['max-zero-rate'] || process.env.SEARCH_REPORT_MAX_ZERO_RATE || 0.1);

const normalizeText = (value) => String(value === undefined || value === null ? '' : value).trim();
const normalizeLower = (value) => normalizeText(value).toLowerCase();

const fetchSearch = async (entry = {}) => {
    const url = new URL('/api/products', `${baseUrl}/`);
    url.searchParams.set('limit', String(entry.limit || 10));
    url.searchParams.set('sort', String(entry.sort || 'relevance'));
    url.searchParams.set('telemetryContext', 'seeded_benchmark');

    if (entry.query) {
        url.searchParams.set('keyword', String(entry.query));
    }

    Object.entries(entry.filters || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    });

    const response = await fetch(url);
    const json = await response.json();
    if (!response.ok) {
        throw new Error(json?.message || `Search request failed with ${response.status}`);
    }
    return json;
};

const scoreProduct = (product = {}, expectations = {}) => {
    const title = normalizeLower(product.title);
    const brand = normalizeLower(product.brand);
    const category = normalizeLower(product.category);
    const trusted = ['verified', 'curated', 'first_party'].includes(normalizeLower(product?.provenance?.trustTier));
    const publishReady = Boolean(product?.contentQuality?.publishReady);
    const inStock = Number(product?.stock || 0) > 0;

    let score = 0;
    let possible = 0;

    const titleIncludes = Array.isArray(expectations.titleIncludes) ? expectations.titleIncludes : [];
    if (titleIncludes.length > 0) {
        possible += 4;
        if (titleIncludes.some((entry) => title.includes(normalizeLower(entry)))) score += 4;
    }

    const brandIncludes = Array.isArray(expectations.brandIncludes) ? expectations.brandIncludes : [];
    if (brandIncludes.length > 0) {
        possible += 3;
        if (brandIncludes.some((entry) => brand.includes(normalizeLower(entry)))) score += 3;
    }

    const categoryIncludes = Array.isArray(expectations.categoryIncludes) ? expectations.categoryIncludes : [];
    if (categoryIncludes.length > 0) {
        possible += 2;
        if (categoryIncludes.some((entry) => category.includes(normalizeLower(entry)))) score += 2;
    }

    possible += 3;
    if (trusted) score += 1;
    if (publishReady) score += 1;
    if (inStock) score += 1;

    return {
        score,
        possible,
        trusted,
        publishReady,
        inStock,
    };
};

const scoreQueryResult = (entry = {}, response = {}) => {
    const products = Array.isArray(response.products) ? response.products.slice(0, 5) : [];
    if (products.length === 0) {
        return {
            query: entry.query,
            filters: entry.filters || {},
            zeroResult: true,
            scorePct: 0,
            topResults: [],
            competitorOfflineJudgement: entry.competitors || {},
        };
    }

    let totalScore = 0;
    let totalPossible = 0;
    let trustedHits = 0;
    let inStockHits = 0;
    const topResults = products.map((product, index) => {
        const productScore = scoreProduct(product, entry.expectations || {});
        totalScore += productScore.score;
        totalPossible += productScore.possible;
        if (productScore.trusted) trustedHits += 1;
        if (productScore.inStock) inStockHits += 1;
        return {
            rank: index + 1,
            productId: String(product._id || product.id || ''),
            title: product.title || '',
            brand: product.brand || '',
            category: product.category || '',
            stock: Number(product.stock || 0),
            trustTier: product?.provenance?.trustTier || 'unknown',
            publishReady: Boolean(product?.contentQuality?.publishReady),
            score: productScore.score,
            possible: productScore.possible,
        };
    });

    const scorePct = totalPossible > 0
        ? Number(((totalScore / totalPossible) * 100).toFixed(2))
        : 0;

    return {
        query: entry.query,
        filters: entry.filters || {},
        zeroResult: false,
        scorePct,
        trustedHitRatio: Number((trustedHits / products.length).toFixed(3)),
        inStockHitRatio: Number((inStockHits / products.length).toFixed(3)),
        totalReturned: Number(response.total || products.length),
        topResults,
        competitorOfflineJudgement: entry.competitors || {},
    };
};

const run = async () => {
    const corpus = await loadSeededSearchCorpus(corpusPath);
    if (!Array.isArray(corpus) || corpus.length === 0) {
        throw new Error(`Seeded search corpus is empty: ${corpusPath}`);
    }

    const queryReports = [];
    for (const entry of corpus) {
        const response = await fetchSearch(entry);
        queryReports.push(scoreQueryResult(entry, response));
    }

    const zeroResults = queryReports.filter((entry) => entry.zeroResult).length;
    const averageScore = queryReports.length > 0
        ? Number((queryReports.reduce((sum, entry) => sum + Number(entry.scorePct || 0), 0) / queryReports.length).toFixed(2))
        : 0;
    const zeroResultRate = queryReports.length > 0
        ? Number((zeroResults / queryReports.length).toFixed(3))
        : 0;

    const report = {
        mode: 'seeded-prelaunch',
        baseUrl,
        corpusPath,
        queryCount: queryReports.length,
        averageScore,
        zeroResultRate,
        thresholds: {
            minAverageScore,
            maxZeroResultRate,
        },
        passed: averageScore >= minAverageScore && zeroResultRate <= maxZeroResultRate,
        queries: queryReports,
        generatedAt: new Date().toISOString(),
    };

    const outputPath = await writeLatestSearchRelevanceReport(report, reportPath);
    console.log(JSON.stringify({ ...report, reportPath: outputPath }, null, 2));

    if (!report.passed) {
        const failures = [];
        if (averageScore < minAverageScore) {
            failures.push(`average score ${averageScore} < ${minAverageScore}`);
        }
        if (zeroResultRate > maxZeroResultRate) {
            failures.push(`zero-result rate ${zeroResultRate} > ${maxZeroResultRate}`);
        }
        throw new Error(`Search relevance gate failed: ${failures.join('; ')}`);
    }
};

run().catch((error) => {
    console.error(`Search relevance report failed: ${error.message}`);
    process.exitCode = 1;
});
