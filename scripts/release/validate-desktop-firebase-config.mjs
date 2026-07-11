#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sanitizeValue = (value) => String(value || '')
  .replace(/\\[rnt]/g, '')
  .replace(/[\r\n\t]+/g, '')
  .trim();

const parseConfig = (value) => {
  const sanitized = sanitizeValue(value);
  if (!sanitized) return {};

  try {
    const parsed = JSON.parse(sanitized);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const sanitizeHost = (value) => {
  const sanitized = sanitizeValue(value);
  if (!sanitized) return '';

  try {
    return new URL(sanitized.includes('://') ? sanitized : `https://${sanitized}`).hostname.trim();
  } catch {
    return sanitized.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
  }
};

export const resolveDesktopFirebaseConfig = (env = {}) => {
  const aggregate = {
    ...parseConfig(env.VITE_FIREBASE_CONFIG),
    ...parseConfig(env.VITE_FIREBASE_WEB_CONFIG),
  };
  const value = (envKey, configKey, sanitizer = sanitizeValue) => (
    sanitizer(env[envKey]) || sanitizer(aggregate[configKey])
  );
  const projectId = value('VITE_FIREBASE_PROJECT_ID', 'projectId');
  const derivedAuthDomain = /^[a-z0-9-]+$/i.test(projectId)
    ? `${projectId}.firebaseapp.com`
    : '';

  return {
    apiKey: value('VITE_FIREBASE_API_KEY', 'apiKey'),
    authDomain: value('VITE_FIREBASE_AUTH_DOMAIN', 'authDomain', sanitizeHost) || derivedAuthDomain,
    projectId,
    appId: value('VITE_FIREBASE_APP_ID', 'appId'),
  };
};

export const validateDesktopFirebaseConfig = (env = {}) => {
  const config = resolveDesktopFirebaseConfig(env);
  const missing = Object.entries(config)
    .filter(([_key, value]) => !sanitizeValue(value))
    .map(([key]) => key);

  return {
    valid: missing.length === 0,
    missing,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateDesktopFirebaseConfig(process.env);
  if (!result.valid) {
    console.error(`Desktop Firebase auth configuration is incomplete. Missing: ${result.missing.join(', ')}.`);
    process.exit(1);
  }

  console.log('Desktop Firebase auth configuration is complete.');
}
