import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDirectory, '..');
const repoRoot = path.resolve(appRoot, '..');
const distDirectory = path.join(appRoot, 'dist');
const outputDirectory = path.join(repoRoot, '.vercel', 'output');
const staticDirectory = path.join(outputDirectory, 'static');
const routingContractPath = path.join(appRoot, 'config', 'vercelRoutingContract.mjs');

const { FRONTEND_SECURITY_HEADERS, HOSTED_BACKEND_ORIGIN } = await import(pathToFileURL(routingContractPath).href);
const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');
const backendOrigin = trimTrailingSlash(process.env.AURA_BACKEND_ORIGIN || process.env.AWS_BACKEND_BASE_URL || HOSTED_BACKEND_ORIGIN);
const frontendSecurityHeaders = Object.fromEntries(
    FRONTEND_SECURITY_HEADERS.map(({ key, value }) => [key, value])
);

if (!/^https?:\/\//i.test(backendOrigin)) {
    throw new Error(`Expected an absolute backend origin, received "${backendOrigin}"`);
}

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(staticDirectory, { recursive: true });
await cp(distDirectory, staticDirectory, { recursive: true });

const config = {
    version: 3,
    routes: [
        {
            src: '/(.*)',
            headers: frontendSecurityHeaders,
            continue: true,
        },
        {
            src: '/socket\\.io',
            dest: `${backendOrigin}/socket.io/`,
        },
        {
            src: '/socket\\.io/',
            dest: `${backendOrigin}/socket.io/`,
        },
        {
            src: '/socket\\.io/(.*)',
            dest: `${backendOrigin}/socket.io/$1`,
        },
        {
            src: '/api/(.*)',
            dest: `${backendOrigin}/api/$1`,
        },
        {
            src: '/health',
            dest: `${backendOrigin}/health`,
        },
        {
            src: '/health/ready',
            dest: `${backendOrigin}/health/ready`,
        },
        {
            src: '/health/live',
            dest: `${backendOrigin}/health/live`,
        },
        {
            src: '/uploads/(.*)',
            dest: `${backendOrigin}/uploads/$1`,
        },
        {
            handle: 'filesystem',
        },
        {
            src: '/(.*)',
            dest: '/index.html',
        },
    ],
};

await writeFile(path.join(outputDirectory, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);

const indexHtml = await readFile(path.join(staticDirectory, 'index.html'), 'utf8');
if (!indexHtml.includes('aura-release-id')) {
    throw new Error('Vercel static output is missing Aura release metadata.');
}

console.log(`Created Vercel static output from ${path.relative(repoRoot, distDirectory)}.`);
