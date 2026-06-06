const fs = require('fs');
const path = require('path');
const {
    classifyRoute,
    extraRoutes,
    joinExpressPaths,
    routeKey,
    routeMounts,
} = require('./routeExposureRegistry');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

const normalizeRoutePath = (routePath = '') => String(routePath || '')
    .replace(/\(\?:\\\/\|\$\)/g, '')
    .replace(/\\\//g, '/')
    .replace(/\{[^}]*path[^}]*\}/g, ':path')
    .replace(/\*/g, ':path');

const discoverRoutesFromSource = (relativeFile, mountPath) => {
    const absoluteFile = path.join(repoRoot, relativeFile);
    if (!fs.existsSync(absoluteFile)) return [];

    const source = fs.readFileSync(absoluteFile, 'utf8');
    const routes = [];
    const directRegex = /router\.(get|post|put|patch|delete|head|options)\(\s*['"`]([^'"`]+)['"`]/gi;
    const chainRegex = /router\.route\(\s*['"`]([^'"`]+)['"`]\s*\)([\s\S]*?);/g;

    for (const match of source.matchAll(directRegex)) {
        routes.push({
            method: match[1].toUpperCase(),
            path: normalizeRoutePath(joinExpressPaths(mountPath, match[2])),
            file: relativeFile,
            key: '',
        });
    }

    for (const match of source.matchAll(chainRegex)) {
        const routePath = normalizeRoutePath(joinExpressPaths(mountPath, match[1]));
        const chain = match[2] || '';
        for (const methodMatch of chain.matchAll(/\.(get|post|put|patch|delete|head|options)\s*\(/gi)) {
            routes.push({
                method: methodMatch[1].toUpperCase(),
                path: routePath,
                file: relativeFile,
                key: '',
            });
        }
    }

    return routes.map((route) => ({ ...route, key: routeKey(route) }));
};

const discoverBackendRoutes = () => {
    const discovered = routeMounts.flatMap(([relativeFile, mountPath]) => (
        discoverRoutesFromSource(relativeFile, mountPath)
    ));
    const extras = extraRoutes.map((route) => ({ ...route, key: routeKey(route) }));
    const deduped = new Map([...discovered, ...extras].map((route) => [route.key, route]));
    return [...deduped.values()].sort((a, b) => a.key.localeCompare(b.key));
};

const buildRouteExposureInventory = () => discoverBackendRoutes().map((route) => ({
    ...route,
    exposure: classifyRoute(route),
}));

module.exports = {
    buildRouteExposureInventory,
    discoverBackendRoutes,
    discoverRoutesFromSource,
    repoRoot,
};
