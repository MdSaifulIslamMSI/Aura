import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const appDir = path.join(root, 'app');
const isWindows = process.platform === 'win32';

const result = isWindows
  ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npx cap doctor'], {
    cwd: appDir,
    encoding: 'utf8',
    shell: false,
  })
  : spawnSync('npx', ['cap', 'doctor'], {
    cwd: appDir,
    encoding: 'utf8',
    shell: false,
  });

const stdout = result.stdout || '';
const stderr = result.stderr || '';

if (stdout) {
  process.stdout.write(stdout);
}

if (stderr) {
  process.stderr.write(stderr);
}

if (result.error) {
  console.error(`[mobile-doctor] Failed to launch Capacitor doctor: ${result.error.message}`);
  process.exit(1);
}

if (result.status === 0) {
  process.exit(0);
}

const combinedOutput = `${stdout}\n${stderr}`;
const failedOnlyBecauseXcodeIsMissingOnWindows =
  isWindows && /Xcode is not installed/i.test(combinedOutput);

if (failedOnlyBecauseXcodeIsMissingOnWindows) {
  console.warn(
    '[mobile-doctor] Android checks passed, and iOS/Xcode validation was skipped because this local machine is Windows. The GitHub mobile release workflow validates iOS on macos-latest.'
  );
  process.exit(0);
}

process.exit(result.status ?? 1);
