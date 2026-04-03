const fs = require('fs');
const path = require('path');

const SOURCE_DIRECTORIES = Object.freeze(['app', 'server', 'docs', 'infra']);
const TEXT_FILE_EXTENSIONS = new Set([
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.json',
    '.md',
    '.yml',
    '.yaml',
    '.toml',
    '.ps1',
    '.py',
    '.sh',
]);
const SKIPPED_PATH_SEGMENTS = new Set([
    '.git',
    '.next',
    '.turbo',
    'build',
    'coverage',
    'dist',
    'node_modules',
    'uploads',
]);
const MAX_FILE_BYTES = 512_000;
const DEFAULT_CHUNK_LINE_COUNT = 60;

const safeString = (value = '') => String(value ?? '').trim();
const normalizePath = (value = '') => safeString(value).replace(/\\/g, '/');
const normalizeRoutePath = (value = '') => {
    const normalized = `/${safeString(value).replace(/^\/+/, '').replace(/\/+/g, '/')}`;
    return normalized === '/' ? normalized : normalized.replace(/\/$/, '');
};
const unique = (values = []) => [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];

const detectSubsystem = (relativePath = '') => {
    if (relativePath.startsWith('app/')) return 'frontend';
    if (relativePath.startsWith('server/')) return 'backend';
    if (relativePath.startsWith('docs/')) return 'docs';
    if (relativePath.startsWith('infra/')) return 'infra';
    return 'workspace';
};

const tokenize = (value = '') => unique(
    safeString(value)
        .toLowerCase()
        .split(/[^a-z0-9_:/.-]+/i)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length >= 2)
);

const shouldSkipPath = (absolutePath = '') => {
    const normalized = normalizePath(absolutePath);
    return [...SKIPPED_PATH_SEGMENTS].some((segment) => normalized.includes(`/${segment}/`) || normalized.endsWith(`/${segment}`));
};

const looksLikeTextSource = (absolutePath = '') => TEXT_FILE_EXTENSIONS.has(path.extname(absolutePath).toLowerCase());

const readFileSafely = (absolutePath) => {
    const stats = fs.statSync(absolutePath);
    if (!stats.isFile()) return null;
    if (stats.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(absolutePath, 'utf8');
};

const collectSourceFiles = ({ repoRoot }) => {
    const files = [];

    const visitDirectory = (absoluteDir) => {
        if (!fs.existsSync(absoluteDir) || shouldSkipPath(absoluteDir)) return;

        const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
        entries.forEach((entry) => {
            const absolutePath = path.join(absoluteDir, entry.name);
            if (shouldSkipPath(absolutePath)) return;

            if (entry.isDirectory()) {
                visitDirectory(absolutePath);
                return;
            }

            if (!looksLikeTextSource(absolutePath)) return;

            try {
                const content = readFileSafely(absolutePath);
                if (!content) return;
                const relativePath = normalizePath(path.relative(repoRoot, absolutePath));
                files.push({
                    absolutePath,
                    relativePath,
                    subsystem: detectSubsystem(relativePath),
                    content,
                });
            } catch {
                // Ignore unreadable files so the bundle can still be generated.
            }
        });
    };

    SOURCE_DIRECTORIES.forEach((relativeDirectory) => visitDirectory(path.join(repoRoot, relativeDirectory)));
    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
};

const resolveModuleCandidates = (basePath = '') => [
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, 'index.js'),
    path.join(basePath, 'index.jsx'),
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
];

const resolveRepoModulePath = ({ importerPath, requestPath, repoRoot }) => {
    const normalizedRequest = safeString(requestPath);
    if (!normalizedRequest || !normalizedRequest.startsWith('.')) return null;

    const candidateBase = path.resolve(path.dirname(importerPath), normalizedRequest);
    const resolvedCandidate = resolveModuleCandidates(candidateBase).find((candidate) => fs.existsSync(candidate));
    if (!resolvedCandidate) return null;

    const relativePath = normalizePath(path.relative(repoRoot, resolvedCandidate));
    return relativePath || null;
};

const extractImportRequests = (content = '') => {
    const imports = [];
    const importPattern = /import\s+[^'"]*?from\s+['"`]([^'"`]+)['"`]/g;
    const requirePattern = /require\(\s*['"`]([^'"`]+)['"`]\s*\)/g;

    let match;
    while ((match = importPattern.exec(content)) !== null) {
        imports.push(match[1]);
    }
    while ((match = requirePattern.exec(content)) !== null) {
        imports.push(match[1]);
    }

    return unique(imports.map((entry) => safeString(entry)).filter(Boolean));
};

const extractApiEndpoints = (content = '') => unique(
    [...String(content || '').matchAll(/['"`](\/api\/[a-z0-9/_:-]+)['"`]/gi)]
        .map((match) => normalizeRoutePath(match[1]))
        .filter(Boolean)
);

const extractMountMap = ({ repoRoot, sourceFiles }) => {
    const indexFile = sourceFiles.find((file) => file.relativePath === 'server/index.js');
    if (!indexFile) return new Map();

    const requireMap = new Map();
    const requirePattern = /const\s+([A-Za-z0-9_$]+)\s*=\s*require\(\s*['"`](\.\/routes\/[^'"`]+)['"`]\s*\)/g;
    let match;
    while ((match = requirePattern.exec(indexFile.content)) !== null) {
        const absoluteModulePath = path.resolve(path.dirname(indexFile.absolutePath), match[2]);
        const resolvedPath = resolveModuleCandidates(absoluteModulePath).find((candidate) => fs.existsSync(candidate));
        if (!resolvedPath) continue;
        requireMap.set(match[1], normalizePath(path.relative(repoRoot, resolvedPath)));
    }

    const mountMap = new Map();
    const usePattern = /app\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z0-9_$]+)\s*\)/g;
    while ((match = usePattern.exec(indexFile.content)) !== null) {
        const prefix = normalizeRoutePath(match[1]);
        const routeFile = requireMap.get(match[2]);
        if (!routeFile) continue;
        mountMap.set(routeFile, prefix);
    }

    return mountMap;
};

const extractRouteEntries = ({ content = '', prefix = '' }) => {
    const routeEntries = [];
    const chainedPattern = /router\.route\(\s*['"`]([^'"`]+)['"`]\s*\)([\s\S]*?)(?=router\.route\(|module\.exports|$)/g;
    let match;
    while ((match = chainedPattern.exec(content)) !== null) {
        const localPath = normalizeRoutePath(match[1]);
        const chainBody = match[2] || '';
        const methodMatches = [...chainBody.matchAll(/\.(get|post|put|patch|delete)\(/gi)];
        if (methodMatches.length === 0) {
            routeEntries.push({
                method: 'CHAIN',
                path: localPath,
                fullPath: normalizeRoutePath(`${prefix}/${localPath}`),
            });
            continue;
        }
        methodMatches.forEach((methodMatch) => {
            routeEntries.push({
                method: safeString(methodMatch[1]).toUpperCase(),
                path: localPath,
                fullPath: normalizeRoutePath(`${prefix}/${localPath}`),
            });
        });
    }

    const directPattern = /router\.(get|post|put|patch|delete|use)\(\s*['"`]([^'"`]+)['"`]/gi;
    while ((match = directPattern.exec(content)) !== null) {
        routeEntries.push({
            method: safeString(match[1]).toUpperCase(),
            path: normalizeRoutePath(match[2]),
            fullPath: normalizeRoutePath(`${prefix}/${match[2]}`),
        });
    }

    return unique(routeEntries.map((entry) => `${entry.method}:${entry.fullPath}`)).map((key) => {
        const [method, fullPath] = key.split(':');
        const localPath = fullPath.startsWith(prefix)
            ? normalizeRoutePath(fullPath.slice(prefix.length) || '/')
            : fullPath;
        return {
            method,
            path: localPath,
            fullPath,
        };
    });
};

const buildBackendDependencyIndex = ({ repoRoot, sourceFiles }) => {
    const fileIndex = new Map();
    sourceFiles
        .filter((file) => file.relativePath.startsWith('server/'))
        .forEach((file) => {
            const importRequests = extractImportRequests(file.content);
            const resolvedImports = unique(importRequests
                .map((requestPath) => resolveRepoModulePath({
                    importerPath: file.absolutePath,
                    requestPath,
                    repoRoot,
                }))
                .filter(Boolean));

            const serviceRefs = resolvedImports.filter((entry) => entry.startsWith('server/services/'));
            const modelRefs = resolvedImports.filter((entry) => entry.startsWith('server/models/'));
            const controllerRefs = resolvedImports.filter((entry) => entry.startsWith('server/controllers/'));

            fileIndex.set(file.relativePath, {
                imports: resolvedImports,
                serviceRefs,
                modelRefs,
                controllerRefs,
            });
        });

    return fileIndex;
};

const buildRouteMap = ({ repoRoot, sourceFiles }) => {
    const mountMap = extractMountMap({ repoRoot, sourceFiles });
    const dependencyIndex = buildBackendDependencyIndex({ repoRoot, sourceFiles });

    return sourceFiles
        .filter((file) => file.relativePath.startsWith('server/routes/'))
        .flatMap((file) => {
            const prefix = mountMap.get(file.relativePath) || '';
            const routeEntries = extractRouteEntries({
                content: file.content,
                prefix,
            });
            const dependencies = dependencyIndex.get(file.relativePath) || {
                controllerRefs: [],
            };

            return routeEntries.map((entry) => {
                const controllerRefs = dependencies.controllerRefs;
                const serviceRefs = unique(controllerRefs.flatMap((controllerRef) => dependencyIndex.get(controllerRef)?.serviceRefs || []));
                const modelRefs = unique([
                    ...dependencies.modelRefs,
                    ...controllerRefs.flatMap((controllerRef) => dependencyIndex.get(controllerRef)?.modelRefs || []),
                    ...serviceRefs.flatMap((serviceRef) => dependencyIndex.get(serviceRef)?.modelRefs || []),
                ]);

                return {
                    ...entry,
                    prefix,
                    file: file.relativePath,
                    controllerRefs,
                    serviceRefs,
                    modelRefs,
                };
            });
        });
};

const extractTopLevelSchemaFields = (content = '') => {
    const lines = String(content || '').split(/\r?\n/);
    const fields = [];
    let schemaStarted = false;
    let depth = 0;

    lines.forEach((line) => {
        if (!schemaStarted && line.includes('mongoose.Schema({')) {
            schemaStarted = true;
            depth = 1;
            return;
        }
        if (!schemaStarted) return;

        const openCount = (line.match(/{/g) || []).length;
        const closeCount = (line.match(/}/g) || []).length;
        if (depth === 1) {
            const fieldMatch = line.match(/^\s{4}([A-Za-z0-9_]+)\s*:/);
            if (fieldMatch?.[1]) {
                fields.push(fieldMatch[1]);
            }
        }
        depth += openCount - closeCount;
        if (depth <= 0) {
            schemaStarted = false;
        }
    });

    return unique(fields);
};

const buildModelMap = ({ sourceFiles }) => sourceFiles
    .filter((file) => file.relativePath.startsWith('server/models/'))
    .map((file) => {
        const match = file.content.match(/mongoose\.model\(\s*['"`]([^'"`]+)['"`]/);
        if (!match?.[1]) return null;
        return {
            name: safeString(match[1]),
            file: file.relativePath,
            fields: extractTopLevelSchemaFields(file.content),
        };
    })
    .filter(Boolean);

const buildFrontendMap = ({ repoRoot, sourceFiles }) => sourceFiles
    .filter((file) => file.relativePath.startsWith('app/src/'))
    .map((file) => {
        const importRequests = extractImportRequests(file.content);
        const imports = unique(importRequests
            .map((requestPath) => resolveRepoModulePath({
                importerPath: file.absolutePath,
                requestPath,
                repoRoot,
            }))
            .filter(Boolean));

        const routeGuess = file.relativePath.includes('/pages/')
            ? normalizePath(file.relativePath.split('/pages/')[1] || '')
            : '';

        return {
            file: file.relativePath,
            routeGuess,
            apiEndpoints: extractApiEndpoints(file.content),
            imports,
        };
    });

const createBundleChunkId = ({ path: relativePath, startLine = 1 }) => `${relativePath}:${startLine}`;

const buildChunks = ({ sourceFiles }) => sourceFiles.flatMap((file) => {
    const lines = String(file.content || '').split(/\r?\n/);
    const chunks = [];
    for (let start = 0; start < lines.length; start += DEFAULT_CHUNK_LINE_COUNT) {
        const startLine = start + 1;
        const endLine = Math.min(lines.length, start + DEFAULT_CHUNK_LINE_COUNT);
        const text = lines.slice(start, endLine).join('\n').trim();
        if (!text) continue;
        chunks.push({
            id: createBundleChunkId({
                path: file.relativePath,
                startLine,
            }),
            path: file.relativePath,
            subsystem: file.subsystem,
            startLine,
            endLine,
            text,
            keywords: tokenize(`${file.relativePath} ${text}`).slice(0, 80),
        });
    }
    return chunks;
});

const buildGraph = ({ sourceFiles, routeMap, modelMap, frontendMap, repoRoot }) => {
    const nodes = [];
    const edges = [];
    const nodeIds = new Set();
    const edgeKeys = new Set();

    const addNode = (node) => {
        if (!node?.id || nodeIds.has(node.id)) return;
        nodeIds.add(node.id);
        nodes.push(node);
    };

    const addEdge = (edge) => {
        if (!edge?.from || !edge?.to) return;
        const key = `${edge.from}:${edge.to}:${edge.type || 'related'}`;
        if (edgeKeys.has(key)) return;
        edgeKeys.add(key);
        edges.push(edge);
    };

    const backendDependencyIndex = buildBackendDependencyIndex({ repoRoot, sourceFiles });

    sourceFiles.forEach((file) => {
        addNode({
            id: `file:${file.relativePath}`,
            type: 'file',
            label: path.basename(file.relativePath),
            path: file.relativePath,
            subsystem: file.subsystem,
        });
    });

    modelMap.forEach((model) => {
        addNode({
            id: `model:${model.name}`,
            type: 'model',
            label: model.name,
            path: model.file,
            subsystem: 'backend',
        });
        addEdge({
            from: `file:${model.file}`,
            to: `model:${model.name}`,
            type: 'defines_model',
        });
    });

    routeMap.forEach((route) => {
        addNode({
            id: `route:${route.method}:${route.fullPath}`,
            type: 'route',
            label: `${route.method} ${route.fullPath}`,
            path: route.fullPath,
            subsystem: 'backend',
        });
        addEdge({
            from: `file:${route.file}`,
            to: `route:${route.method}:${route.fullPath}`,
            type: 'declares_route',
        });
        route.controllerRefs.forEach((controllerRef) => addEdge({
            from: `route:${route.method}:${route.fullPath}`,
            to: `file:${controllerRef}`,
            type: 'handled_by',
        }));
        route.serviceRefs.forEach((serviceRef) => addEdge({
            from: `route:${route.method}:${route.fullPath}`,
            to: `file:${serviceRef}`,
            type: 'invokes_service',
        }));
        route.modelRefs.forEach((modelRef) => {
            const modelName = modelMap.find((entry) => entry.file === modelRef)?.name || path.basename(modelRef, path.extname(modelRef));
            addEdge({
                from: `route:${route.method}:${route.fullPath}`,
                to: `model:${modelName}`,
                type: 'touches_model',
            });
        });
    });

    frontendMap.forEach((entry) => {
        const fileNodeId = `file:${entry.file}`;
        addNode({
            id: fileNodeId,
            type: 'frontend_file',
            label: path.basename(entry.file),
            path: entry.file,
            subsystem: 'frontend',
        });

        entry.imports.forEach((importRef) => addEdge({
            from: fileNodeId,
            to: `file:${importRef}`,
            type: 'imports',
        }));

        entry.apiEndpoints.forEach((endpoint) => {
            routeMap
                .filter((route) => route.fullPath === endpoint || endpoint.startsWith(route.prefix) || route.fullPath.startsWith(endpoint))
                .slice(0, 6)
                .forEach((route) => addEdge({
                    from: fileNodeId,
                    to: `route:${route.method}:${route.fullPath}`,
                    type: 'calls_api',
                }));
        });
    });

    for (const [filePath, dependencies] of backendDependencyIndex.entries()) {
        dependencies.imports.forEach((importRef) => addEdge({
            from: `file:${filePath}`,
            to: `file:${importRef}`,
            type: 'imports',
        }));
        dependencies.modelRefs.forEach((modelRef) => {
            const modelName = modelMap.find((entry) => entry.file === modelRef)?.name;
            if (!modelName) return;
            addEdge({
                from: `file:${filePath}`,
                to: `model:${modelName}`,
                type: 'uses_model',
            });
        });
    }

    return {
        nodes,
        edges,
    };
};

const buildInvariantDocs = ({ sourceFiles }) => sourceFiles
    .filter((file) => file.relativePath.startsWith('docs/'))
    .map((file) => ({
        path: file.relativePath,
        title: path.basename(file.relativePath),
        excerpt: String(file.content || '').split(/\r?\n/).slice(0, 24).join('\n').trim(),
    }));

const buildCodeIntelligenceBundle = ({
    repoRoot = path.resolve(__dirname, '..', '..', '..'),
    commitSha = process.env.GITHUB_SHA || process.env.APP_BUILD_SHA || 'dev-local',
    builtAt = new Date().toISOString(),
} = {}) => {
    const sourceFiles = collectSourceFiles({ repoRoot });
    const routeMap = buildRouteMap({ repoRoot, sourceFiles });
    const modelMap = buildModelMap({ sourceFiles });
    const frontendMap = buildFrontendMap({ repoRoot, sourceFiles });
    const chunks = buildChunks({ sourceFiles });
    const graph = buildGraph({
        sourceFiles,
        routeMap,
        modelMap,
        frontendMap,
        repoRoot,
    });

    return {
        schemaVersion: 1,
        commitSha: safeString(commitSha || 'dev-local') || 'dev-local',
        builtAt,
        sourceDirectories: SOURCE_DIRECTORIES,
        files: sourceFiles.map((file) => ({
            path: file.relativePath,
            subsystem: file.subsystem,
            lineCount: String(file.content || '').split(/\r?\n/).length,
            content: file.content,
            imports: extractImportRequests(file.content),
            apiEndpoints: extractApiEndpoints(file.content),
        })),
        chunks,
        routeMap,
        modelMap,
        frontendMap,
        graph,
        invariants: buildInvariantDocs({ sourceFiles }),
    };
};

module.exports = {
    SOURCE_DIRECTORIES,
    buildCodeIntelligenceBundle,
};
