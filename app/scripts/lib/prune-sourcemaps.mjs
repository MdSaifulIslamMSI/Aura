import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

// The build-frontend job publishes sourcemaps to Sentry, so the copy that
// rides along inside the Vercel payload is dead weight: it doubled every
// retained deployment's upload and served source from the CDN.
export const collectSourceMaps = async (directory) => {
    const found = [];
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            found.push(...await collectSourceMaps(entryPath));
        } else if (entry.name.endsWith('.map')) {
            found.push(entryPath);
        }
    }

    return found;
};

export const pruneSourceMaps = async (directory) => {
    const sourceMaps = await collectSourceMaps(directory);
    const bytes = (await Promise.all(sourceMaps.map(async (filePath) => (
        (await stat(filePath)).size
    )))).reduce((total, size) => total + size, 0);

    await Promise.all(sourceMaps.map((filePath) => rm(filePath, { force: true })));

    return { bytes, count: sourceMaps.length };
};