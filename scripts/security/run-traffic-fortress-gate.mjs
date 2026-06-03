import { spawnSync } from 'node:child_process';

const commands = [
  ['npm', ['run', 'security:traffic:matrix:strict']],
  ['npm', ['run', 'security:traffic:rate-limits:strict']],
  ['npm', ['run', 'security:traffic:proof:strict']],
  ['npm', ['run', 'security:maturity:strict']],
];

let failed = false;
for (const [command, args] of commands) {
  const printable = [command, ...args].join(' ');
  console.log(`[traffic-fortress-gate] running ${printable}`);
  const spawnCommand = process.platform === 'win32' && command === 'npm' ? 'cmd.exe' : command;
  const spawnArgs = process.platform === 'win32' && command === 'npm'
    ? ['/d', '/s', '/c', command, ...args]
    : args;
  const result = spawnSync(spawnCommand, spawnArgs, { stdio: 'inherit' });
  if (result.error) {
    failed = true;
    console.error(`[traffic-fortress-gate] spawn failed: ${result.error.message}`);
    break;
  }
  if (result.status !== 0) {
    failed = true;
    console.error(`[traffic-fortress-gate] failed: ${printable}`);
    break;
  }
}

if (failed) process.exit(1);
console.log('[traffic-fortress-gate] passed');
