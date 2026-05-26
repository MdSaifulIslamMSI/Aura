#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node scripts/run-bash.mjs <script.sh> [args...]');
  process.exit(1);
}

const existing = (candidate) => candidate && fs.existsSync(candidate);

const findBash = () => {
  if (existing(process.env.BASH_PATH)) return process.env.BASH_PATH;
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
    ];
    const match = candidates.find(existing);
    if (match) return match;
  }
  return 'bash';
};

const result = spawnSync(findBash(), args, {
  stdio: 'inherit',
  env: process.env,
  shell: false,
});

if (result.error) {
  console.error(`Failed to run Bash script: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
