import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), '../..');
const scanRoots = ['app/src', 'app/scripts', 'server', 'scripts'];
const ignoredDirectoryNames = new Set(['node_modules', 'dist', 'coverage', 'test-results']);
const ignoredFilePaths = new Set([
    'scripts/i18n/scan-forbidden-endpoints.mjs',
]);
const sourceExtensions = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const forbiddenPatterns = [
    {
        id: 'unofficial-google-translate-endpoint',
        pattern: ['translate.googleapis.com', '/translate_a/single'].join(''),
    },
];

const walkFiles = (directoryPath) => {
    if (!fs.existsSync(directoryPath)) return [];

    return fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
        if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) {
            return [];
        }

        const resolvedPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            return walkFiles(resolvedPath);
        }

        return sourceExtensions.has(path.extname(entry.name)) ? [resolvedPath] : [];
    });
};

const violations = scanRoots
    .flatMap((scanRoot) => walkFiles(path.join(rootDir, scanRoot)))
    .flatMap((filePath) => {
        const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
        if (ignoredFilePaths.has(relativePath)) return [];

        const source = fs.readFileSync(filePath, 'utf8');
        return forbiddenPatterns.flatMap(({ id, pattern }) => (
            source.includes(pattern) ? [{ file: relativePath, id }] : []
        ));
    });

if (violations.length > 0) {
    console.error('Forbidden i18n endpoint scan failed.');
    violations.forEach(({ file, id }) => {
        console.error(`- ${id}: ${file}`);
    });
    process.exit(1);
}

console.log('Forbidden i18n endpoint scan passed.');
