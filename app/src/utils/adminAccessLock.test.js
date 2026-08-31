import { describe, expect, it } from 'vitest';
import {
  ADMIN_ACCESS_LOCK_CODES,
  isAdminAccessLockCode,
  isAdminAccessLockMessage,
  getAdminAccessLockTitle,
  getAdminAccessLockOperatorMessage,
  getAdminAccessLockPayload,
  getAdminAccessLockFromIntelligence,
} from './adminAccessLock';

describe('adminAccessLock', () => {
  describe('isAdminAccessLockCode', () => {
    it('recognizes known codes case-insensitively', () => {
      expect(isAdminAccessLockCode('admin_allowlist_missing')).toBe(true);
      expect(isAdminAccessLockCode('  ADMIN_ALLOWLIST_DENIED ')).toBe(true);
    });

    it('rejects unknown and empty codes', () => {
      expect(isAdminAccessLockCode('SOMETHING_ELSE')).toBe(false);
      expect(isAdminAccessLockCode('')).toBe(false);
    });
  });

  describe('isAdminAccessLockMessage', () => {
    it('matches known lock phrases regardless of casing and spacing', () => {
      expect(isAdminAccessLockMessage('Admin access is locked.')).toBe(true);
      expect(isAdminAccessLockMessage('  The   allowlist is not configured ')).toBe(true);
      expect(isAdminAccessLockMessage('ADMIN ACCESS DENIED FOR THIS ACCOUNT')).toBe(true);
    });

    it('rejects unrelated messages', () => {
      expect(isAdminAccessLockMessage('Invalid credentials')).toBe(false);
      expect(isAdminAccessLockMessage('')).toBe(false);
    });
  });

  describe('getAdminAccessLockPayload', () => {
    it('returns null for non-403 statuses', () => {
      expect(getAdminAccessLockPayload({ status: 401, data: { code: 'ADMIN_ALLOWLIST_MISSING' } })).toBeNull();
      expect(getAdminAccessLockPayload({ status: 500, message: 'admin access is locked' })).toBeNull();
    });

    it('parses a code-bearing 403 payload', () => {
      const payload = getAdminAccessLockPayload({
        status: 403,
        data: { code: 'admin_allowlist_denied', reason: 'not allowlisted', requestId: 'req-1' },
        url: '/api/admin/stats',
      });
      expect(payload).toMatchObject({
        status: 403,
        code: ADMIN_ACCESS_LOCK_CODES.ALLOWLIST_DENIED,
        reason: 'not_allowlisted',
        requestId: 'req-1',
        url: '/api/admin/stats',
      });
    });

    it('infers the code from the message when the code field is absent', () => {
      const denied = getAdminAccessLockPayload({ status: 403, message: 'admin access denied for this account' });
      expect(denied.code).toBe(ADMIN_ACCESS_LOCK_CODES.ALLOWLIST_DENIED);

      const missing = getAdminAccessLockPayload({ status: 403, message: 'Admin access is locked' });
      expect(missing.code).toBe(ADMIN_ACCESS_LOCK_CODES.ALLOWLIST_MISSING);
    });

    it('defaults the reason and message when the payload omits them', () => {
      const payload = getAdminAccessLockPayload({ status: 403, data: { code: 'ADMIN_ALLOWLIST_MISSING' } });
      expect(payload.reason).toBe('allowlist_missing');
      expect(payload.message).toBe('Admin access is locked: allowlist is not configured');
      expect(payload.status).toBe(403);
    });

    it('returns null for 403 responses that are not allowlist locks', () => {
      expect(getAdminAccessLockPayload({ status: 403, message: 'Token expired' })).toBeNull();
      expect(getAdminAccessLockPayload({})).toBeNull();
    });
  });

  describe('operator copy helpers', () => {
    it('differentiates titles and operator guidance by lock code', () => {
      expect(getAdminAccessLockTitle({ code: 'ADMIN_ALLOWLIST_DENIED' }))
        .toBe('Admin account is not allowlisted');
      expect(getAdminAccessLockTitle({}))
        .toBe('Admin access is locked');

      expect(getAdminAccessLockOperatorMessage({ code: 'ADMIN_ALLOWLIST_DENIED' }))
        .toContain('ADMIN_ALLOWLIST_EMAILS');
      expect(getAdminAccessLockOperatorMessage({}))
        .toContain('allowlist configuration is missing');
    });
  });

  describe('getAdminAccessLockFromIntelligence', () => {
    it('builds a lock payload from intelligence.adminAccess', () => {
      const payload = getAdminAccessLockFromIntelligence({
        adminAccess: { locked: true, code: 'ADMIN_ALLOWLIST_MISSING' },
      });
      expect(payload).toMatchObject({ status: 403, code: ADMIN_ACCESS_LOCK_CODES.ALLOWLIST_MISSING });
    });

    it('reads the nested posture policy shape', () => {
      const payload = getAdminAccessLockFromIntelligence({
        posture: { policy: { adminAccess: { locked: true, code: 'ADMIN_ALLOWLIST_DENIED' } } },
      });
      expect(payload.code).toBe(ADMIN_ACCESS_LOCK_CODES.ALLOWLIST_DENIED);
    });

    it('returns null when admin access is unlocked or missing', () => {
      expect(getAdminAccessLockFromIntelligence({ adminAccess: { locked: false } })).toBeNull();
      expect(getAdminAccessLockFromIntelligence(null)).toBeNull();
      expect(getAdminAccessLockFromIntelligence({})).toBeNull();
    });
  });
});
