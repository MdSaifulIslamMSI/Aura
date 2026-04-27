import { describe, expect, test } from 'vitest';
import {
  buildInternationalPhoneNumber,
  buildGenericOtpFlowError,
  createEmptyFormData,
  createEmptyOtpValues,
  getPhoneNationalInputValue,
  getAuthPurpose,
  isEnumerationSensitiveOtpError,
  normalizeEmail,
  normalizePhone,
  OTP_LENGTH,
  resolvePhoneCountryCode,
  resolveLaunchMode,
  resolveLaunchPrefill,
  shouldKeepSpecificOtpError,
  validateEmail,
  validatePhone,
} from './loginFlowHelpers';

describe('loginFlowHelpers', () => {
  test('resolves launch mode with safe fallback', () => {
    expect(resolveLaunchMode('signup')).toBe('signup');
    expect(resolveLaunchMode('bad-mode')).toBe('signin');
  });

  test('normalizes launch prefill and identity helpers', () => {
    expect(resolveLaunchPrefill({
      authPrefill: {
        email: '  USER@Example.com ',
        phone: '  +91 99999 11111 ',
      },
    })).toEqual({
      email: 'user@example.com',
      phone: '+91 99999 11111',
    });

    expect(normalizeEmail('  USER@Example.com ')).toBe('user@example.com');
    expect(normalizePhone(' +91 (999) 991-1111 ')).toBe('+919999911111');
  });

  test('validates auth purpose and phone or email formats', () => {
    expect(getAuthPurpose('signup')).toBe('signup');
    expect(getAuthPurpose('forgot-password')).toBe('forgot-password');
    expect(getAuthPurpose('signin')).toBe('login');

    expect(validatePhone('+15551234567')).toBe(true);
    expect(validatePhone('+447911123456')).toBe(true);
    expect(validatePhone('+919999911111')).toBe(true);
    expect(validatePhone('9876543210')).toBe(false);
    expect(validatePhone('12345')).toBe(false);
    expect(validateEmail('user@example.com')).toBe(true);
    expect(validateEmail('not-an-email')).toBe(false);
  });

  test('composes international phone numbers from country picker state', () => {
    expect(resolvePhoneCountryCode('', 'IN')).toBe('IN');
    expect(resolvePhoneCountryCode('+44 7911 123456', 'IN')).toBe('GB');
    expect(buildInternationalPhoneNumber('202 555 0142', 'US')).toBe('+12025550142');
    expect(buildInternationalPhoneNumber('98765 43210', 'IN')).toBe('+919876543210');
    expect(buildInternationalPhoneNumber('+971 50 123 4567', 'IN')).toBe('+971501234567');
    expect(getPhoneNationalInputValue('+919876543210', 'IN')).toBe('9876543210');
    expect(getPhoneNationalInputValue('+447911123456', 'IN')).toBe('7911123456');
  });

  test('creates resettable empty auth form state', () => {
    expect(createEmptyOtpValues()).toEqual(Array(OTP_LENGTH).fill(''));
    expect(createEmptyFormData({ email: 'user@example.com' })).toEqual({
      name: '',
      email: 'user@example.com',
      phone: '',
      password: '',
      confirmPassword: '',
    });
  });

  test('classifies OTP errors for enumeration-safe masking', () => {
    expect(isEnumerationSensitiveOtpError({
      status: 404,
    })).toBe(true);

    expect(isEnumerationSensitiveOtpError({
      message: 'Phone mismatch for account',
    })).toBe(true);

    expect(shouldKeepSpecificOtpError({
      message: 'No verified account found for this recovery flow',
    })).toBe(true);
  });

  test('builds the generic OTP error shell with translator output', () => {
    const t = (_key, _params, fallback) => `wrapped:${fallback}`;
    expect(buildGenericOtpFlowError(t)).toEqual({
      message: 'wrapped:If the account details are valid, continue with OTP verification.',
    });
  });
});
