import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FRONTEND_CONNECT_SRC,
  FRONTEND_CONTENT_SECURITY_POLICY,
} from '../../config/vercelRoutingContract.mjs';

const projectRootPath = process.cwd();

const readProjectFile = (relativePath) => (
  readFileSync(path.resolve(projectRootPath, relativePath), 'utf8')
);

const getDirective = (policy = '', name = '') => String(policy || '')
  .split(';')
  .map((directive) => directive.trim())
  .find((directive) => directive.startsWith(`${name} `)) || '';

const getDirectiveSources = (policy = '', name = '') => getDirective(policy, name)
  .split(/\s+/)
  .slice(1);

const expectHardenedConnectSrc = (policy = '') => {
  const sources = getDirectiveSources(policy, 'connect-src');

  expect(sources).toContain("'self'");
  expect(sources).toContain('https://dbtrhsolhec1s.cloudfront.net');
  expect(sources).toContain('wss://dbtrhsolhec1s.cloudfront.net');
  expect(sources).toContain('https://api.stripe.com');
  expect(sources).toContain('https://api.github.com');
  expect(sources).toContain('https://*.googleapis.com');
  expect(sources).not.toContain('https:');
  expect(sources).not.toContain('wss:');
};

const readVercelCsp = (relativePath) => {
  const config = JSON.parse(readProjectFile(relativePath));
  return config.headers?.[0]?.headers?.find((header) => header.key === 'Content-Security-Policy')?.value || '';
};

const readNetlifyCsp = () => (
  readProjectFile('../netlify.toml').match(/Content-Security-Policy\s*=\s*"([^"]+)"/)?.[1] || ''
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

  it('keeps browser connection egress on explicit provider and backend allowlists', () => {
    expect(FRONTEND_CONNECT_SRC).not.toContain('https:');
    expect(FRONTEND_CONNECT_SRC).not.toContain('wss:');
    expectHardenedConnectSrc(FRONTEND_CONTENT_SECURITY_POLICY);

    const html = readProjectFile('index.html');
    const htmlCsp = html.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] || '';
    expectHardenedConnectSrc(htmlCsp);
  });

  it('keeps generated deployment CSP headers aligned with the hardened connect-src policy', () => {
    expectHardenedConnectSrc(readVercelCsp('../vercel.json'));
    expectHardenedConnectSrc(readVercelCsp('vercel.json'));
    expectHardenedConnectSrc(readNetlifyCsp());
  });
});
