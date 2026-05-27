import { runCommand } from './command.mjs';

const commands = [
  ['npm', ['run', 'perf:smoke']],
  ['npm', ['run', 'perf:load']],
  ['npm', ['run', 'perf:lighthouse']],
  ['npm', ['run', 'perf:budget']],
];

for (const [command, args] of commands) {
  const result = runCommand(command, args, { stdio: 'inherit', env: process.env });
  if (result.error) {
    console.error(result.error.message);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
