#!/usr/bin/env node
// Install the local pre-push folder gate.
//
// The hook itself is local state (.git/hooks is never tracked), so a fresh
// clone does not have it. This copies the tracked template into place and
// marks it executable. Re-run after checking out a new clone or after Git
// updates its hook directory.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const template = path.join(repoRoot, 'scripts', 'dev', 'pre-push');
const hooksDir = path.join(repoRoot, '.git', 'hooks');
const target = path.join(hooksDir, 'pre-push');

const fail = (message) => {
    console.error(`folder:guard:install: ${message}`);
    process.exitCode = 1;
};

if (!fs.existsSync(template)) {
    fail(`template missing: ${template}`);
} else if (!fs.existsSync(hooksDir)) {
    fail('.git/hooks not found; run this from the repository root');
} else {
    // Normalize line endings so the shebang survives a CRLF checkout.
    const content = fs.readFileSync(template, 'utf8').replace(/\r\n/g, '\n');
    fs.writeFileSync(target, content, 'utf8');

    if (process.platform === 'win32') {
        const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
        const gitRoot = execPath.status === 0
            ? path.resolve(execPath.stdout.trim(), '..', '..', '..')
            : '';
        const chmod = path.join(gitRoot, 'usr', 'bin', 'chmod.exe');
        const result = fs.existsSync(chmod)
            ? spawnSync(chmod, ['+x', target], { stdio: 'inherit' })
            : spawnSync('chmod', ['+x', target], { stdio: 'inherit' });
        if (result.status !== 0) {
            fail('could not mark the hook executable');
        }
    } else {
        fs.chmodSync(target, 0o755);
    }

    if (!process.exitCode) {
        console.log(`folder:guard:install: installed ${target}`);
    }
}
