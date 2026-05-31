import { spawnSync } from 'node:child_process';

export const assertSafeWindowsToken = (value) => {
  const raw = String(value);
  if (!/^[a-zA-Z0-9_@./:=+-]+$/.test(raw)) {
    throw new Error(`Unsafe Windows command token: ${raw}`);
  }
  return raw;
};

export const runCommand = (command, args = [], options = {}) => {
  if (process.platform !== 'win32') {
    return spawnSync(command, args, options);
  }

  return spawnSync(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', [command, ...args].map(assertSafeWindowsToken).join(' ')],
    options,
  );
};
