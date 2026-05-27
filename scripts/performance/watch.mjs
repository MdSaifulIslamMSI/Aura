import { runCommand } from './command.mjs';

const gh = runCommand('gh', ['--version'], { stdio: 'pipe' });
if (gh.status !== 0) {
  console.warn('GitHub CLI is not available; skipping PR check watch.');
  process.exit(0);
}

const result = runCommand('gh', ['pr', 'checks', '--watch'], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
