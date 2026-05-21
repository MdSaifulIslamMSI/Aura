import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const parseEnvText = (text = '') => {
  const parsed = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[match[1]] = value;
  }
  return parsed;
};

export const loadStudentPackEnv = ({
  override = false,
  paths = [
    join(repoRoot, '.student-pack.local.env'),
    join(repoRoot, '.env.local'),
  ],
} = {}) => {
  const loadedFiles = [];
  for (const candidate of paths.map((entry) => resolve(entry))) {
    if (!existsSync(candidate)) continue;
    const parsed = parseEnvText(readFileSync(candidate, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (override || !process.env[key]) {
        process.env[key] = value;
      }
    }
    loadedFiles.push(candidate);
  }
  return loadedFiles;
};

export { repoRoot };
