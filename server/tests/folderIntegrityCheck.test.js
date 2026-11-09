// Regression proof for scripts/dev/check-folder-integrity.mjs.
//
// The gate exists because a stale checkout passes every test run inside it.
// Each case below builds a throwaway repository with a real origin, plants one
// kind of drift, and asserts that the gate refuses to pass.

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_DIR = path.resolve(__dirname, '..', '..');
const GUARD = path.join(REPO_DIR, 'scripts', 'dev', 'check-folder-integrity.mjs');

const git = (cwd, ...args) => execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe',
});

const writeJson = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const writePackageFixture = (dir) => {
    writeJson(path.join(dir, 'package.json'), {
        name: 'fixture',
        version: '1.0.0',
        private: true,
    });
    writeJson(path.join(dir, 'package-lock.json'), {
        name: 'fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: { '': { name: 'fixture', version: '1.0.0' } },
    });
    writeJson(path.join(dir, 'node_modules', '.package-lock.json'), {
        name: 'fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: { '': { name: 'fixture', version: '1.0.0' } },
    });
};

const buildRepo = () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-integrity-'));
    const origin = path.join(base, 'origin.git');
    const work = path.join(base, 'work');

    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin], { encoding: 'utf8' });

    fs.mkdirSync(work, { recursive: true });
    git(work, 'init', '-q', '-b', 'main');
    git(work, 'config', 'user.email', 'fixture@example.invalid');
    git(work, 'config', 'user.name', 'Fixture');
    fs.writeFileSync(path.join(work, '.gitignore'), 'node_modules/\n', 'utf8');
    writePackageFixture(work);
    writePackageFixture(path.join(work, 'app'));
    writePackageFixture(path.join(work, 'server'));

    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'fixture');
    git(work, 'remote', 'add', 'origin', origin);
    git(work, 'push', '-q', '-u', 'origin', 'main');

    return { base, origin, work };
};

const runGuard = (work, extraArgs = []) => {
    const result = spawnSync(process.execPath, [GUARD, ...extraArgs], {
        env: {
            ...process.env,
            FOLDER_CHECK_ROOT: work,
            FOLDER_CHECK_OFFLINE: '0',
        },
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

describe('folder integrity gate', () => {
    const bases = [];

    afterAll(() => {
        for (const base of bases) {
            fs.rmSync(base, { recursive: true, force: true });
        }
    });

    const fixture = () => {
        const value = buildRepo();
        bases.push(value.base);
        return value;
    };

    test('passes a synced, provisioned folder', () => {
        const { work } = fixture();
        const result = runGuard(work);
        expect(result.code).toBe(0);
        expect(result.output).toContain('folder:check PASSED');
    });

    test('fails when HEAD is behind origin/main', () => {
        const { work } = fixture();
        fs.writeFileSync(path.join(work, 'newer.txt'), 'newer\n', 'utf8');
        git(work, 'add', 'newer.txt');
        git(work, 'commit', '-q', '-m', 'newer');
        git(work, 'push', '-q', 'origin', 'main');
        git(work, 'reset', '--hard', '-q', 'HEAD~1');

        const result = runGuard(work);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('behind');
    });

    test('fails when a second worktree exists', () => {
        const { base, work } = fixture();
        const extra = path.join(base, 'extra');
        git(work, 'worktree', 'add', '-q', '--detach', extra, 'main');

        const result = runGuard(work);
        expect(result.code).toBe(1);
        expect(result.output).toContain('checkouts exist');

        git(work, 'worktree', 'remove', '--force', extra);
    });

    test('fails when a stash holds work', () => {
        const { work } = fixture();
        fs.writeFileSync(path.join(work, 'scratch.txt'), 'scratch\n', 'utf8');
        git(work, 'stash', 'push', '-q', '-u', '-m', 'fixture');

        const result = runGuard(work);
        expect(result.code).toBe(1);
        expect(result.output).toContain('stash');
    });

    test('fails when node_modules is empty', () => {
        const { work } = fixture();
        fs.rmSync(path.join(work, 'app', 'node_modules'), { recursive: true, force: true });
        fs.mkdirSync(path.join(work, 'app', 'node_modules'));

        const result = runGuard(work);
        expect(result.code).toBe(1);
        expect(result.output).toContain('node_modules is empty');
    });

    test('fails when an installed version differs from the lockfile', () => {
        const { work } = fixture();
        const dir = path.join(work, 'server');

        const lockPath = path.join(dir, 'package-lock.json');
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        lock.packages['node_modules/fixture-dep'] = { version: '2.0.0' };
        writeJson(lockPath, lock);

        const packagePath = path.join(dir, 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        packageJson.dependencies = { 'fixture-dep': '^2.0.0' };
        writeJson(packagePath, packageJson);

        const hiddenPath = path.join(dir, 'node_modules', '.package-lock.json');
        const hidden = JSON.parse(fs.readFileSync(hiddenPath, 'utf8'));
        hidden.packages['node_modules/fixture-dep'] = { version: '1.0.0' };
        writeJson(hiddenPath, hidden);
        writeJson(path.join(dir, 'node_modules', 'fixture-dep', 'package.json'), {
            name: 'fixture-dep',
            version: '1.0.0',
        });

        const result = runGuard(work);
        expect(result.code).toBe(1);
        expect(result.output).toContain('differ from package-lock.json');
    });

    test('tolerates optional packages npm skips for this platform', () => {
        const { work } = fixture();
        const lockPath = path.join(work, 'server', 'package-lock.json');
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        lock.packages['node_modules/optional-dep'] = { version: '1.0.0', optional: true };
        lock.packages['node_modules/optional-wasm'] = { version: '1.0.0', optional: true, cpu: ['wasm32'] };
        lock.packages['node_modules/optional-wasm/node_modules/optional-child'] = { version: '1.0.0' };
        writeJson(lockPath, lock);

        expect(runGuard(work).code).toBe(0);
        expect(runGuard(work, ['--strict']).code).toBe(0);
    });
});
