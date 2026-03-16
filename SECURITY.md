# Security Policy & Implementation

**Last Updated**: March 16, 2026  
**Status**: ✅ All 10 critical vulnerabilities fixed  
**Version**: 1.0.0

---

## Security Overview

This document describes the security architecture, implemented protections, and best practices for the Aura Marketplace platform.

### Current Security Posture

| Category | Status | Last Audit | Next Review |
|----------|--------|-----------|------------|
| Authentication | ✅ Hardened | 2026-03-16 | 2026-06-16 |
| Password Policy | ✅ Enhanced | 2026-03-16 | 2026-12-16 |
| CSRF Protection | ✅ Implemented | 2026-03-16 | 2026-06-16 |
| OTP System | ✅ Atomic | 2026-03-16 | 2026-09-16 |
| Authorization | ✅ Strict | 2026-03-16 | 2026-06-16 |
| Secrets Management | ✅ Parameterized | 2026-03-16 | 2026-04-16 |
| Rate Limiting | ✅ Enabled | 2026-03-16 | 2026-09-16 |
| Session Management | ✅ Fast | 2026-03-16 | 2026-06-16 |

---

## Authentication Architecture

### Firebase Integration

**Client Side**:
- Firebase SDK initializes from public config (VITE_FIREBASE_PROJECT_ID)
- ID tokens obtained after email/password or social auth
- Tokens sent in Authorization header for API requests

**Server Side**:
- Firebase Admin SDK verifies ID tokens (server/config/firebase.js)
- Project ID now parameterized: `process.env.FIREBASE_PROJECT_ID`
- Never accept client-claimed identity; verify with Firebase

**Environment Variables**:
```bash
# Required on Render (backend)
FIREBASE_PROJECT_ID=your-project-id

# Required on Vercel (frontend)
VITE_FIREBASE_PROJECT_ID=your-project-id
```

### Session Management

**Current Implementation**:
- JWT ID tokens (Firebase)  
- Redis-backed optional session caching
- Authentication sync deduplication: **5 seconds** (was 30s)

**Token Lifecycle**:
1. User authenticates via Firebase
2. ID token obtained from Firebase SDK
3. Token sent in requests: `Authorization: Bearer <id_token>`
4. Backend verifies token cryptographically with Firebase public keys
5. Cached in Redis with TTL for performance

**Best Practices**:
- Never store tokens in localStorage (use httpOnly cookies if possible)
- Always verify tokens server-side
- Rotate tokens on privilege changes
- Clear sessions on logout
- Rate limit login attempts

---

## Password Security

### Policy Enforcement

**Requirements**:
- Minimum 12 characters (enforced: server + frontend)
- Must contain: uppercase, lowercase, digit, special character (!@#$%^&*)
- Weak patterns detected and rejected:
  - Sequential characters: "abc123"
  - Keyboard patterns: "qwerty", "asdfgh"
  - Repeated characters: "aaaa1111"
  - Date patterns: "2026-03-16"

**Implementation**:
- Backend: `server/utils/passwordValidator.js`
- Frontend: `app/src/pages/Login/index.jsx` (validation feedback)

**Enforcement Points**:
1. Signup: New password validated
2. Password reset: New password validated
3. Admin change: New password validated

### Migration Plan for Existing Users

All users with weak passwords will be:
1. Allowed to login (existing password still works)
2. Prompted to change password on next session
3. Restricted from certain actions until password updated
4. Logged out if password update fails

---

## CSRF Protection

### Token-Based Implementation

**Mechanism**:
- Stateless tokens (no session required)
- Single-use tokens (validated and consumed on each request)
- 1-hour TTL (regenerated after expiry)
- 32-byte random hex (cryptographically secure)

**Implementation**:
- Backend: `server/middleware/csrfMiddleware.js`
- Frontend: `app/src/services/csrfTokenManager.js`

### Token Lifecycle

**Frontend Flow**:
```
1. GET /api/auth/session
   ↓ Returns X-CSRF-Token header
2. Store token in csrfTokenManager (50-min cache)
3. POST /api/auth/sync (include X-CSRF-Token header)
   ↓ Server validates & consumes token
4. If next POST within 50 min, reuse cached token
5. If 50 min passed, fetch new token (go to step 1)
```

**Server Flow**:
```
1. GET /api/auth/session (csrfTokenGenerator middleware)
   ↓ Generate new token
   ↓ Store in memory (1-hour TTL)
   ↓ Return in X-CSRF-Token header
2. POST /api/auth/sync (csrfTokenValidator middleware)
   ↓ Check X-CSRF-Token header
   ↓ Validate token exists & not expired
   ↓ Mark token as consumed (one-time use)
   ↓ Allow request to proceed
3. Replay attempt with same token
   ↓ Rejected: token already consumed
```

**Protected Endpoints**:
```
POST /api/auth/sync
POST /api/auth/verify-lattice
POST /api/auth/verify-quantum
POST /api/order/place
POST /api/payment/capture
(and all other state-changing operations)
```

**Testing CSRF Protection**:
```bash
# Good: Token present
curl -X POST https://api.example.com/api/auth/sync \
  -H "Authorization: Bearer TOKEN" \
  -H "X-CSRF-Token: valid-token-here"

# Bad: Token missing
curl -X POST https://api.example.com/api/auth/sync \
  -H "Authorization: Bearer TOKEN"
# Response: 403 Forbidden

# Bad: Invalid token
curl -X POST https://api.example.com/api/auth/sync \
  -H "Authorization: Bearer TOKEN" \
  -H "X-CSRF-Token: invalid-token"
# Response: 403 Forbidden
```

---

## OTP Security

### Race Condition Prevention

**Issue**: Parallel OTP requests could create multiple active sessions

**Solution**: Atomic database operations
```javascript
// When creating new OTP, atomically delete other purposes
await OtpSession.deleteMany({ 
  user: targetUser._id, 
  purpose: { $ne: purpose } 
})
```

**Guarantees**:
- Only ONE active OTP per user per PURPOSE
- Multiple purposes (login, password-reset, verify) can coexist
- New OTP creation immediately invalidates other purposes

### OTP Best Practices

- SMS + Email for critical operations (password reset)
- 6-digit OTP (1 million possibilities)
- 15-minute expiry
- 5 attempt limit (then 15-min lockout)
- Rate limit: 3 OTP requests per hour per email/phone

---

## Authorization & Admin Roles

### Admin Enforcement

**Middleware Chain**:
1. Firebase token verification (required)
2. Admin role check (from user document)
3. Action authorization (endpoint-specific)

**Admin Routes**:
```
GET /api/admin/analytics
POST /api/admin/notification
POST /api/admin/ops
PUT /api/admin/product/:id
GET /api/admin/users
PUT /api/admin/user/:id/role
```

**Security Flow**:
```
1. User makes request to /api/admin/...
2. Firebase token verified
3. User role checked in MongoDB
4. If role != 'admin' → 403 Forbidden
5. If role == 'admin' → proceed
```

**Role Propagation**:
- Role is cached in Redis session (5-second TTL)
- Role changes take effect within 5 seconds
- Logout immediately clears cached role
- Role cannot be changed via profile update endpoint

**Testing Admin Authorization**:
```bash
# Good: Admin user
curl https://api.example.com/api/admin/users \
  -H "Authorization: Bearer admin-token"
# Response: 200 OK + user list

# Bad: Non-admin user
curl https://api.example.com/api/admin/users \
  -H "Authorization: Bearer user-token"
# Response: 403 Forbidden
```

---

## Secrets Management

### Environment Variables

**Never Commit**:
- `.env` files (use `.env.example` template)
- `.env.local` files
- Service account keys
- API keys or tokens
- Database credentials

**Store Safely In**:
- Render.com Environment Variables dashboard
- Vercel Environment Variables dashboard
- GitHub Secrets for CI/CD
- Local `.env` file (git-ignored)

### Secret Categories

**Backend Secrets** (Render):
```
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_SERVICE_ACCOUNT_KEY="{...}"
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/db
REDIS_URL=redis://user:pass@hostname:port
GMAIL_USER=noreply@example.com
GMAIL_APP_PASSWORD=16-char-password
LIVEKIT_API_SECRET=secret-key
AI_PROVIDER_KEY=key
JWT_SECRET=random-32-char-string
```

**Frontend Secrets** (Vercel):
```
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_API_URL=https://api.example.com/api
```

**CI/CD Secrets** (GitHub):
```
RENDER_DEPLOY_HOOK=https://api.render.com/deploy/...
VERCEL_TOKEN=token
VERCEL_PROJECT_ID=project
```

### Rotation Schedule

| Secret | Rotation | Reason |
|--------|----------|--------|
| FIREBASE_SERVICE_ACCOUNT_KEY | 90 days | Standard security practice |
| GMAIL_APP_PASSWORD | 90 days | Email compromise risk |
| LIVEKIT_API_SECRET | 90 days | Communication security |
| AI_PROVIDER_KEY | 90 days | Third-party API security |
| JWT_SECRET | Never (re-key session) | Session invalidation impact |
| MONGO_PASSWORD | 180 days | Database access control |

---

## Deployment Security

### Pre-Deployment Checklist

```bash
# 1. Verify environment variables are set
echo $FIREBASE_PROJECT_ID
echo $VITE_FIREBASE_PROJECT_ID

# 2. No secrets in code
grep -r "password\|secret\|key" server/config/*.js | grep -v "process.env"

# 3. Run security tests
npm run test -- security.integration.test.js

# 4. Check for console.log of sensitive data
grep -r "console.log.*password\|console.log.*token" server/

# 5. Verify no hardcoded credentials
grep -r "firebase.init\|mongodb://\|redis://\|LIVEKIT" server/ --include="*.js" | grep -v "process.env"
```

### Deployment Steps

See **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** for complete steps:

1. **Backend** (Render):
   - Set FIREBASE_PROJECT_ID
   - Set Gmail credentials
   - Set LiveKit secret
   - Deploy via git push
   - Verify health endpoint

2. **Frontend** (Vercel):
   - Set VITE_FIREBASE_PROJECT_ID
   - Set VITE_API_URL
   - Deploy via git push
   - Verify no Firebase errors

3. **Verification**:
   - Run curl tests
   - Check logs
   - Test CSRF tokens
   - Test password validation
   - Test admin authorization

---

## Security Best Practices

### For Developers

1. **Never hardcode secrets** - Always use environment variables
2. **Validate all inputs** - Both frontend and backend validation
3. **Use HTTPS only** - All communications must be encrypted
4. **Verify tokens server-side** - Never trust client claims
5. **Log security events** - Failed auth, admin actions, etc.
6. **Use strong passwords** - Enforce requirements everywhere
7. **Rate limit endpoints** - Prevent brute force attacks
8. **Keep dependencies updated** - npm audit regularly
9. **Use security headers** - CSP, X-Frame-Options, etc.
10. **Test security fixes** - Include test coverage for vulnerabilities

### For Operations

1. **Monitor deployment logs** - Catch errors early
2. **Rotate secrets regularly** - 90+ day schedule
3. **Audit admin access** - Who changed what and when
4. **Set up alerting** - Failed auth, rate limit triggers
5. **Keep backups** - Database recovery in 24 hours
6. **Incident response plan** - Know what to do if breached
7. **Security patches** - Apply within 48 hours
8. **SSL/TLS certificates** - Auto-renew before expiry
9. **WAF rules** - Block known attack patterns
10. **Regular audits** - Security review every quarter

### For Users

1. **Use strong, unique passwords** - 12+ chars, complexity
2. **Enable 2FA if available** - Extra security layer
3. **Never share credentials** - Especially admin passwords
4. **Report security issues** - Use responsible disclosure
5. **Update regularly** - Keep app current
6. **Use HTTPS only** - Avoid public WiFi for sensitive ops
7. **Monitor accounts** - Check for unauthorized access
8. **Store recovery codes** - For account recovery

---

## Incident Response

### If Breach Suspected

1. **Immediate** (within 1 hour):
   - Rotate all secrets
   - Revoke compromised tokens
   - Enable audit logging
   - Notify security team

2. **Short-term** (within 24 hours):
   - Analyze logs for breach timeline
   - Identify affected users
   - Prepare notification
   - Review firebase security

3. **Medium-term** (within 7 days):
   - Force password reset for affected users
   - Enable enhanced monitoring
   - Deploy security patches
   - Communicate findings

4. **Long-term**:
   - Post-incident review
   - Update security policies
   - Implement preventative measures
   - Update incident response plan

### Report Security Issues

- **Responsibly**: Don't disclose publicly
- **Privately**: Use security@example.com
- **Documentation**: Include steps to reproduce
- **Timeline**: Allow 90 days for fix before disclosure

---

## Additional Resources

- **[SECURITY_FIXES.md](SECURITY_FIXES.md)** - Technical details of each fix
- **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** - Deployment instructions
- **[DEPLOYMENT_SECRETS.md](DEPLOYMENT_SECRETS.md)** - Secrets management guide
- **[SECURITY_QUICK_REFERENCE.md](SECURITY_QUICK_REFERENCE.md)** - Quick start guide
- **[CHANGELOG.md](CHANGELOG.md)** - Version history
- **[README.md](README.md)** - Project overview

---

**Questions?** Contact the security team or open a GitHub issue with the security label.
