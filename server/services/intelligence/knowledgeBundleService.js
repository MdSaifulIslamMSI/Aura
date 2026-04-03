const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const { buildCodeIntelligenceBundle } = require('./codeIntelligenceBuilder');

const GENERATED_BUNDLE_PATH = path.resolve(__dirname, '..', '..', 'generated', 'intelligence', 'current', 'bundle.json');
const REPO_ROOT = path.resolve(
    process.env.INTELLIGENCE_REPO_ROOT
    || path.resolve(__dirname, '..', '..', '..')
);

let cachedBundle = null;
let cachedBundleSource = '';

const safeString = (value = '') => String(value ?? '').trim();
const normalizePath = (value = '') => safeString(value).replace(/\\/g, '/');

const tokenize = (value = '') => [...new Set(
    safeString(value)
        .toLowerCase()
        .split(/[^a-z0-9_:/.-]+/i)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length >= 2)
)];

const resolveExpectedBundleVersion = () => safeString(
    process.env.APP_BUILD_SHA
    || process.env.RENDER_GIT_COMMIT
    || process.env.GITHUB_SHA
    || ''
);

const loadBundleFromDisk = () => {
    if (!fs.existsSync(GENERATED_BUNDLE_PATH)) return null;
    const raw = fs.readFileSync(GENERATED_BUNDLE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cachedBundle = parsed;
    cachedBundleSource = 'generated';
    return parsed;
};

const buildFallbackBundle = () => {
    const bundle = buildCodeIntelligenceBundle({
        repoRoot: REPO_ROOT,
    });
    cachedBundle = bundle;
    cachedBundleSource = 'runtime_fallback';
    return bundle;
};

const getActiveKnowledgeBundle = async ({ allowBuildFallback = true } = {}) => {
    if (cachedBundle) return cachedBundle;

    try {
        const bundle = loadBundleFromDisk();
        if (bundle) return bundle;
    } catch (error) {
        logger.warn('intelligence.bundle_load_failed', {
            error: error.message,
            path: GENERATED_BUNDLE_PATH,
        });
    }

    if (!allowBuildFallback) return null;

    logger.warn('intelligence.bundle_fallback_build', {
        path: GENERATED_BUNDLE_PATH,
    });
    return buildFallbackBundle();
};

const getBundleVersionInfo = async () => {
    const bundle = await getActiveKnowledgeBundle();
    const expectedCommitSha = resolveExpectedBundleVersion();
    const bundleVersion = safeString(bundle?.commitSha || '');
    return {
        bundleVersion,
        builtAt: safeString(bundle?.builtAt || ''),
        expectedCommitSha,
        stale: Boolean(expectedCommitSha && bundleVersion && expectedCommitSha !== bundleVersion),
        source: cachedBundleSource || 'unknown',
    };
};

const scoreTextAgainstTerms = ({ text = '', path: targetPath = '', terms = [] }) => {
    if (!Array.isArray(terms) || terms.length === 0) return 0;
    const haystack = `${safeString(targetPath)} ${safeString(text)}`.toLowerCase();
    let score = 0;
    terms.forEach((term) => {
        if (!term) return;
        if (haystack.includes(term)) score += 2;
        const wordBoundaryPattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (wordBoundaryPattern.test(haystack)) score += 3;
    });
    return score;
};

const searchCodeChunks = async ({
    query = '',
    limit = 6,
    subsystem = '',
} = {}) => {
    const bundle = await getActiveKnowledgeBundle();
    const terms = tokenize(query);
    if (!bundle || terms.length === 0) return [];

    return (bundle.chunks || [])
        .filter((chunk) => !subsystem || chunk.subsystem === subsystem)
        .map((chunk) => ({
            ...chunk,
            scoreValue: scoreTextAgainstTerms({
                text: chunk.text,
                path: chunk.path,
                terms,
            }),
        }))
        .filter((chunk) => chunk.scoreValue > 0)
        .sort((left, right) => right.scoreValue - left.scoreValue)
        .slice(0, Math.max(1, Math.min(Number(limit) || 6, 12)))
        .map((chunk) => ({
            id: chunk.id,
            label: `${chunk.path}:${chunk.startLine}`,
            type: chunk.subsystem === 'docs' ? 'doc' : 'code',
            path: chunk.path,
            excerpt: chunk.text,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            score: Math.min(1, chunk.scoreValue / Math.max(terms.length * 5, 1)),
            metadata: {
                subsystem: chunk.subsystem,
            },
        }));
};

const getFileSection = async ({
    targetPath = '',
    startLine = 0,
    endLine = 0,
    aroundLine = 0,
    radius = 12,
} = {}) => {
    const bundle = await getActiveKnowledgeBundle();
    if (!bundle) return null;

    const normalizedTargetPath = normalizePath(targetPath);
    const file = (bundle.files || []).find((entry) => normalizePath(entry.path) === normalizedTargetPath);
    if (!file?.content) return null;

    const lines = String(file.content || '').split(/\r?\n/);
    const resolvedStart = Math.max(1, Number(startLine) || (Number(aroundLine) > 0 ? Number(aroundLine) - Number(radius || 12) : 1));
    const resolvedEnd = Math.min(
        lines.length,
        Number(endLine) || (Number(aroundLine) > 0 ? Number(aroundLine) + Number(radius || 12) : resolvedStart + Number(radius || 12))
    );

    return {
        path: file.path,
        subsystem: file.subsystem,
        startLine: resolvedStart,
        endLine: resolvedEnd,
        content: lines.slice(resolvedStart - 1, resolvedEnd).join('\n'),
    };
};

const traceSystemPath = async ({
    query = '',
    limit = 4,
} = {}) => {
    const bundle = await getActiveKnowledgeBundle();
    if (!bundle) return [];

    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const nodes = Array.isArray(bundle.graph?.nodes) ? bundle.graph.nodes : [];
    const edges = Array.isArray(bundle.graph?.edges) ? bundle.graph.edges : [];

    const scoredNodes = nodes
        .map((node) => ({
            ...node,
            scoreValue: scoreTextAgainstTerms({
                text: `${node.label || ''} ${node.path || ''}`,
                path: node.path,
                terms,
            }),
        }))
        .filter((node) => node.scoreValue > 0)
        .sort((left, right) => right.scoreValue - left.scoreValue)
        .slice(0, Math.max(1, Math.min(Number(limit) || 4, 8)));

    return scoredNodes.map((node) => {
        const relatedEdges = edges
            .filter((edge) => edge.from === node.id || edge.to === node.id)
            .slice(0, 8);
        return {
            focus: node,
            steps: relatedEdges.map((edge) => {
                const fromNode = nodes.find((candidate) => candidate.id === edge.from) || null;
                const toNode = nodes.find((candidate) => candidate.id === edge.to) || null;
                return {
                    type: edge.type,
                    from: fromNode,
                    to: toNode,
                };
            }),
        };
    });
};

const getRouteContract = async ({ endpoint = '' } = {}) => {
    const bundle = await getActiveKnowledgeBundle();
    if (!bundle) return [];

    const normalizedEndpoint = normalizePath(endpoint).toLowerCase();
    return (bundle.routeMap || [])
        .filter((route) => {
            const fullPath = normalizePath(route.fullPath).toLowerCase();
            const localPath = normalizePath(route.path).toLowerCase();
            return fullPath === normalizedEndpoint
                || fullPath.includes(normalizedEndpoint)
                || localPath === normalizedEndpoint
                || localPath.includes(normalizedEndpoint);
        })
        .slice(0, 10);
};

const getModelSchema = async ({ modelName = '' } = {}) => {
    const bundle = await getActiveKnowledgeBundle();
    if (!bundle) return [];

    const normalizedModelName = safeString(modelName).toLowerCase();
    return (bundle.modelMap || [])
        .filter((model) => model.name.toLowerCase() === normalizedModelName || model.name.toLowerCase().includes(normalizedModelName))
        .slice(0, 10);
};

const listGroundingSources = async ({ citations = [] } = {}) => {
    const citationSources = Array.isArray(citations) ? citations : [];
    const bundleInfo = await getBundleVersionInfo();
    return citationSources.map((citation) => ({
        label: safeString(citation?.label || citation?.path || ''),
        path: safeString(citation?.path || ''),
        type: safeString(citation?.type || 'code') || 'code',
        bundleVersion: bundleInfo.bundleVersion,
    }));
};

const resetKnowledgeBundleCache = () => {
    cachedBundle = null;
    cachedBundleSource = '';
};

module.exports = {
    GENERATED_BUNDLE_PATH,
    getActiveKnowledgeBundle,
    getBundleVersionInfo,
    getFileSection,
    getModelSchema,
    listGroundingSources,
    resetKnowledgeBundleCache,
    searchCodeChunks,
    traceSystemPath,
    getRouteContract,
};
