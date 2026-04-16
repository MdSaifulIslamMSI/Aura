import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRootPath = process.cwd();

const readProjectFile = (relativePath) => (
  readFileSync(path.resolve(projectRootPath, relativePath), 'utf8')
);

describe('auth CSP allowlists', () => {
  const expectedSources = [
    'https://apis.google.com',
    'https://accounts.google.com',
    'https://www.google.com',
    'https://www.gstatic.com',
    'https://www.recaptcha.net',
  ];

  it('keeps the static app shell compatible with Google and Firebase auth', () => {
    const html = readProjectFile('index.html');

    expectedSources.forEach((source) => {
      expect(html).toContain(source);
    });
  });

  it('keeps the server CSP compatible with Google and Firebase auth', () => {
    const serverIndex = readProjectFile('../server/index.js');

    expectedSources.forEach((source) => {
      expect(serverIndex).toContain(source);
    });
  });
});
