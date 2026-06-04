#!/usr/bin/env node
import { randomBytes } from 'node:crypto';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith('--')) continue;
  const [rawKey, inlineValue] = arg.slice(2).split('=');
  const nextValue = process.argv[index + 1];
  const value = inlineValue ?? (nextValue && !nextValue.startsWith('--') ? nextValue : 'true');
  args.set(rawKey, value);
  if (inlineValue === undefined && value === nextValue) index += 1;
}

const bytes = Number.parseInt(args.get('bytes') || '32', 10);
const format = String(args.get('format') || 'base64').toLowerCase();
const supportedFormats = new Set(['base64', 'hex']);

if (!Number.isInteger(bytes) || bytes < 32) {
  console.error('MFA secret generation requires --bytes to be an integer of at least 32.');
  process.exit(1);
}

if (!supportedFormats.has(format)) {
  console.error('MFA secret generation supports --format base64 or --format hex.');
  process.exit(1);
}

process.stdout.write(`${randomBytes(bytes).toString(format)}\n`);
