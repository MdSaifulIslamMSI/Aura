// Regression proof for scripts/check-repo-hygiene.mjs.
//
// A hygiene guard that only ever passes is worse than none, because it reports
// a clean tree while the problem is still there. Each case below builds a
// throwaway git repository, plants a specific hazard in it, and asserts the
// guard either catches it or deliberately allows it.

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_DIR = path.resolve(__dirname, '..', '..');
const GUARD = path.join(REPO_DIR, 'scripts', 'check-repo-hygiene.mjs');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', shell: false });

// Minimal repository: one tracked file, so the guard has something to read and
// `git ls-files` returns cleanly.
const buildRepo = ({ tracked = { 'README.md': '# fixture\n' } } = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-hygiene-'));
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'fixture@example.invalid');
    git(root, 'config', 'user.name', 'Fixture');
    for (const [rel, content] of Object.entries(tracked)) {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
    }
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'fixture');
    return root;
};

const runGuard = (repoRoot, extraArgs = []) => {
    const result = spawnSync(process.execPath, [GUARD, ...extraArgs], {
        env: { ...process.env, HYGIENE_REPO_ROOT: repoRoot },
        encoding: 'utf8',
        shell: false,
    });
    return {
        code: result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        output: `${result.stdout || ''}${result.stderr || ''}`,
    };
};

// The guard logs human lines and the JSON payload to the same stream, so the
// payload has to be bounded by the outermost braces rather than read to the end.
const extractJson = (stdout) => {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    return JSON.parse(stdout.slice(start, end + 1));
};

describe('repo hygiene guard', () => {
    const roots = [];

    afterAll(() => {
        for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
    });

    const track = (root) => {
        roots.push(root);
        return root;
    };

    test('passes a clean repository', () => {
        const root = track(buildRepo());
        const result = runGuard(root);
        expect(result.output).toContain('no personal email addresses');
        expect(result.code).toBe(0);
    });

    // The hazard this guard exists for: a live users dump holds no credentials,
    // so the credential scanner passes it and it sits one `git add -A` from
    // permanent git history.
    test('fails on a real personal email in tracked content', () => {
        const root = track(buildRepo({
            tracked: { 'users.tmp.json': '{"Out":"alice.smith@gmail.com"}' },
        }));
        const result = runGuard(root);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('personal email address');
        expect(result.stderr).toContain('alice.smith@gmail.com');
    });

    test('fails on a personal email in an untracked file', () => {
        const root = track(buildRepo());
        fs.writeFileSync(path.join(root, 'leak.txt'), 'contact bob@yahoo.com\n', 'utf8');
        const result = runGuard(root);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('bob@yahoo.com');
    });

    test('allows reserved documentation domains', () => {
        const root = track(buildRepo({
            tracked: { 'config.json': '{"support":"help@example.com","ip":"host@example.invalid"}' },
        }));
        const result = runGuard(root);
        expect(result.code).toBe(0);
        expect(result.output).toContain('no personal email addresses');
    });

    test('allows placeholder local parts on personal domains', () => {
        const root = track(buildRepo({
            tracked: { '.env.example': 'ADMIN_EMAIL=admin@gmail.com\n' },
        }));
        const result = runGuard(root);
        expect(result.code).toBe(0);
        expect(result.output).toContain('no personal email addresses');
    });

    test('allows files on the explicit PII allowlist', () => {
        const root = track(buildRepo({
            tracked: { '.gitleaks-baseline.json': '{"author":"owner@gmail.com"}' },
        }));
        const result = runGuard(root);
        expect(result.code).toBe(0);
        expect(result.output).toContain('no personal email addresses');
    });

    test('warns about untracked files at the repo root without failing', () => {
        const root = track(buildRepo());
        fs.writeFileSync(path.join(root, 'scratch.md'), '# notes\n', 'utf8');
        const result = runGuard(root);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('scratch.md');
        expect(result.stdout).toContain('git add -A');
    });

    test('--strict promotes root clutter to a failure', () => {
        const root = track(buildRepo());
        fs.writeFileSync(path.join(root, 'scratch.md'), '# notes\n', 'utf8');
        const result = runGuard(root, ['--strict']);
        expect(result.code).toBe(1);
        expect(result.output).toContain('promoted to failures');
    });

    // Regression: `git stash list` reads the repository-wide stash ref, which a
    // linked worktree shares with its parent. A stash count is machine state, not
    // tree state, so --strict must never assert on it or CI-adjacent runs fail
    // for a reason a checkout cannot control.
    test('never promotes stash presence to a failure under --strict', () => {
        const root = track(buildRepo());
        const result = runGuard(root, ['--strict']);
        expect(result.code).toBe(0);
        expect(result.output).toContain('OK - working directory is clean');
    });

    test('reports stashes in the JSON payload without failing', () => {
        const root = track(buildRepo());
        const result = runGuard(root, ['--json', '--strict']);
        expect(result.code).toBe(0);
        const payload = extractJson(result.stdout);
        expect(Array.isArray(payload.localOnlyWarnings)).toBe(true);
        expect(payload.failures).toHaveLength(0);
    });

    test('warns when a machine-generated tracked file is dirty', () => {
        // The guard counts added lines, so the fixture has to differ by lines,
        // not just by a long single line.
        const root = track(buildRepo({
            tracked: { 'app/public/status-snapshot.json': '{"entries":[]}\n' },
        }));
        const grown = `${'{"id":"stable"}\n'.repeat(600)}{"id":"new"}\n`;
        fs.writeFileSync(path.join(root, 'app/public/status-snapshot.json'), grown, 'utf8');
        const result = runGuard(root);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('app/public/status-snapshot.json');
        expect(result.stdout).toContain('machine-generated');
    });

    test('emits machine-readable output with --json', () => {
        const root = track(buildRepo({
            tracked: { 'leak.json': '{"email":"carol@outlook.com"}' },
        }));
        const result = runGuard(root, ['--json']);
        expect(result.code).toBe(1);
        const payload = extractJson(result.stdout);
        expect(payload.failures.length).toBeGreaterThan(0);
        expect(payload.failures.join(' ')).toContain('carol@outlook.com');
    });
});