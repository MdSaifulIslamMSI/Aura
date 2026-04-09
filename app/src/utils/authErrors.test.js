import { describe, expect, it } from 'vitest';
import { resolveAuthError } from './authErrors';

describe('resolveAuthError', () => {
  it('keeps password invalid-credential errors mapped to password guidance', () => {
    const resolved = resolveAuthError({ code: 'auth/invalid-credential' });

    expect(resolved.title).toBe('Invalid Credentials');
    expect(resolved.detail).toBe('Email or password is incorrect.');
  });

  it('maps social invalid-credential errors away from password guidance', () => {
    const resolved = resolveAuthError({
      code: 'auth/invalid-credential',
      provider: 'X',
      message: 'Firebase: Error (auth/invalid-credential).',
    });

    expect(resolved.title).toBe('X Sign-In Failed');
    expect(resolved.detail).toContain("couldn't complete X authentication");
    expect(resolved.hint).toContain('callback URL');
  });

  it('explains account collisions for social providers', () => {
    const resolved = resolveAuthError({
      code: 'auth/account-exists-with-different-credential',
      provider: 'twitter.com',
      email: 'user@example.com',
    });

    expect(resolved.title).toBe('X Account Already Exists');
    expect(resolved.detail).toContain('user@example.com');
    expect(resolved.action).toBe('signin');
  });

  it('explains missing email access for social providers', () => {
    const resolved = resolveAuthError({
      code: 'auth/social-email-missing',
      provider: 'X',
      message: 'Social account did not provide an email.',
    });

    expect(resolved.title).toBe('X Email Access Required');
    expect(resolved.detail).toContain('did not return an email address');
  });
});
