#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP_TAG_PATTERN = /(?:^|\/)desktop-v(\d+\.\d+\.\d+)(?:\^\{\})?$/;
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export const parseVersion = (value) => {
  const match = VERSION_PATTERN.exec(String(value || '').trim());
  if (!match) {
    throw new Error(`Invalid stable desktop version: ${value}`);
  }

  return {
    raw: match[0],
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

export const compareVersions = (left, right) => {
  const a = typeof left === 'string' ? parseVersion(left) : left;
  const b = typeof right === 'string' ? parseVersion(right) : right;

  return a.major - b.major
    || a.minor - b.minor
    || a.patch - b.patch;
};

export const extractDesktopVersions = (input = '') => String(input)
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(Boolean)
  .map((line) => {
    const match = DESKTOP_TAG_PATTERN.exec(line);
    return match ? match[1] : null;
  })
  .filter(Boolean);

export const highestVersion = (versions = []) => versions
  .map(parseVersion)
  .sort((a, b) => compareVersions(b, a))[0] || null;

export const assertDesktopVersionFloor = ({ requested, existingVersions }) => {
  const requestedVersion = parseVersion(requested);
  const highestExisting = highestVersion(existingVersions);

  if (highestExisting && compareVersions(requestedVersion, highestExisting) <= 0) {
    throw new Error(
      `Desktop version ${requestedVersion.raw} must be greater than existing desktop release ${highestExisting.raw}.`
    );
  }

  return {
    requested: requestedVersion.raw,
    highestExisting: highestExisting?.raw || '',
  };
};

const readArg = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : process.argv[index + 1] || '';
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const requested = readArg('--requested') || process.env.DESKTOP_VERSION || '';
  const stdin = readFileSync(0, 'utf8');

  try {
    const result = assertDesktopVersionFloor({
      requested,
      existingVersions: extractDesktopVersions(stdin),
    });
    const floor = result.highestExisting || 'none';
    console.log(`Desktop version ${result.requested} is above existing release floor ${floor}.`);
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
