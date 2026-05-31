import { existsSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const candidateConfigs = [
  'tsconfig.json',
  'app/tsconfig.json',
  'server/tsconfig.json',
];
const configuredProjects = candidateConfigs.filter((relativePath) => (
  existsSync(path.join(repoRoot, relativePath))
));

if (configuredProjects.length === 0) {
  console.log('[quality:typecheck] skipped: this repository has no TypeScript project config yet.');
  console.log('[quality:typecheck] ESLint still parses the existing TS/TSX compatibility files.');
  process.exit(0);
}

console.error(`[quality:typecheck] TypeScript config detected but no compiler command is wired: ${configuredProjects.join(', ')}`);
console.error('[quality:typecheck] Add a package-local tsc --noEmit command before enabling strict compiler gating.');
process.exit(1);
