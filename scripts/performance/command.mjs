import { spawnSync } from 'node:child_process';

const quoteWindowsArg = (value) => {
  const raw = String(value);
  if (!/[\s"&|<>^]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '\\"')}"`;
};

export const runCommand = (command, args = [], options = {}) => {
  if (process.platform !== 'win32') {
    return spawnSync(command, args, options);
  }

  return spawnSync(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', [command, ...args.map(quoteWindowsArg)].join(' ')],
    options,
  );
};
