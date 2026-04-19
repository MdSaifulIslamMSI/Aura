import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NOOP_BUILD_COMMAND = `node -e "console.log('Using prebuilt frontend artifact')"`;

const parseArgs = (argv = []) => {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');

const args = parseArgs(process.argv.slice(2));
const outputDir = path.resolve(process.cwd(), args.output || path.join('generated', 'vercel-artifact'));
const sourceDistDir = path.resolve(repoRoot, 'app', 'dist');

const projectId = String(args['project-id'] || process.env.VERCEL_PROJECT_ID || '').trim();
const orgId = String(args['org-id'] || process.env.VERCEL_ORG_ID || '').trim();
const projectName = String(args['project-name'] || process.env.VERCEL_PROJECT_NAME || 'app').trim();

if (!projectId) {
  throw new Error('Missing VERCEL_PROJECT_ID for artifact bundle generation.');
}

if (!orgId) {
  throw new Error('Missing VERCEL_ORG_ID for artifact bundle generation.');
}

const bundleAppDir = path.join(outputDir, 'app');
const bundleDistDir = path.join(bundleAppDir, 'dist');
const bundleProjectDir = path.join(outputDir, '.vercel');

const rootVercelConfig = JSON.parse(await readFile(path.join(repoRoot, 'vercel.json'), 'utf8'));
const bundleVercelConfig = {
  ...rootVercelConfig,
  buildCommand: NOOP_BUILD_COMMAND,
  outputDirectory: 'dist',
};

const bundlePackageJson = {
  name: 'vercel-artifact-bundle',
  private: true,
  scripts: {
    build: NOOP_BUILD_COMMAND,
  },
};

const copyDistWithoutHiddenVercel = async () => {
  const stagingDir = await mkdtemp(path.join(os.tmpdir(), 'aura-vercel-artifact-'));

  try {
    await cp(sourceDistDir, stagingDir, { recursive: true, force: true });
    await rm(path.join(stagingDir, '.vercel'), { recursive: true, force: true });
    await cp(stagingDir, bundleDistDir, { recursive: true, force: true });
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
};

await rm(outputDir, { recursive: true, force: true });
await mkdir(bundleProjectDir, { recursive: true });
await mkdir(bundleAppDir, { recursive: true });

await copyDistWithoutHiddenVercel();

await writeFile(
  path.join(bundleProjectDir, 'project.json'),
  `${JSON.stringify({ projectId, orgId, projectName }, null, 2)}\n`,
  'utf8',
);

await writeFile(
  path.join(bundleAppDir, 'package.json'),
  `${JSON.stringify(bundlePackageJson, null, 2)}\n`,
  'utf8',
);

await writeFile(
  path.join(bundleAppDir, 'vercel.json'),
  `${JSON.stringify(bundleVercelConfig, null, 2)}\n`,
  'utf8',
);

console.log(JSON.stringify({
  outputDir,
  projectId,
  orgId,
  projectName,
}, null, 2));
