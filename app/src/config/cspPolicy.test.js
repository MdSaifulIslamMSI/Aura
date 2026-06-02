import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FRONTEND_CONNECT_SRC,
  FRONTEND_CONTENT_SECURITY_POLICY,
  FRONTEND_DEVELOPMENT_CONTENT_SECURITY_POLICY,
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

const expectHardenedConnectSrc = (policy = '', {
  requiresHostedBackend = true,
  allowLocalDevelopmentSources = false,
} = {}) => {
  const sources = getDirectiveSources(policy, 'connect-src');

  expect(sources).toContain("'self'");
  if (requiresHostedBackend) {
    expect(sources).toContain('https://dbtrhsolhec1s.cloudfront.net');
    expect(sources).toContain('wss://dbtrhsolhec1s.cloudfront.net');
  } else {
    expect(sources).not.toContain('https://dbtrhsolhec1s.cloudfront.net');
    expect(sources).not.toContain('wss://dbtrhsolhec1s.cloudfront.net');
  }
  if (allowLocalDevelopmentSources) {
    expect(sources).toContain('http://localhost:*');
    expect(sources).toContain('http://127.0.0.1:*');
    expect(sources).toContain('http://host.docker.internal:*');
  } else {
    expect(sources).not.toContain('http://localhost:*');
    expect(sources).not.toContain('http://127.0.0.1:*');
    expect(sources).not.toContain('http://host.docker.internal:*');
  }
  expect(sources).toContain('https://api.stripe.com');
  expect(sources).toContain('https://api.github.com');
  expect(sources).toContain('https://*.googleapis.com');
  expect(sources).not.toContain('https:');
  expect(sources).not.toContain('wss:');
};

const expectProductionStylePolicy = (policy = '') => {
  expect(getDirectiveSources(policy, 'style-src')).toEqual([
    "'self'",
    'https://fonts.googleapis.com',
  ]);
  expect(getDirectiveSources(policy, 'style-src-attr')).toEqual(["'unsafe-inline'"]);
};

const expectFrameAncestorHeaderPolicy = (policy = '') => {
  expect(getDirectiveSources(policy, 'frame-ancestors')).toEqual(["'none'"]);
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
    expectProductionStylePolicy(FRONTEND_CONTENT_SECURITY_POLICY);

    const html = readProjectFile('index.html');
    const htmlCsp = html.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] || '';
    expectHardenedConnectSrc(htmlCsp);
    expectProductionStylePolicy(htmlCsp);
    expect(getDirective(htmlCsp, 'frame-ancestors')).toBe('');
  });

  it('keeps generated deployment CSP headers aligned with the hardened connect-src policy', () => {
    [
      readVercelCsp('../vercel.json'),
      readVercelCsp('vercel.json'),
      readNetlifyCsp(),
    ].forEach((policy) => {
      expectHardenedConnectSrc(policy);
      expectProductionStylePolicy(policy);
      expectFrameAncestorHeaderPolicy(policy);
    });
  });

  it('keeps local development CSP allowances out of production CSPs', () => {
    expectHardenedConnectSrc(FRONTEND_DEVELOPMENT_CONTENT_SECURITY_POLICY, {
      allowLocalDevelopmentSources: true,
    });
    expect(getDirectiveSources(FRONTEND_DEVELOPMENT_CONTENT_SECURITY_POLICY, 'style-src'))
      .toContain("'unsafe-inline'");
  });
});
