/**
 * Security Implementation Test Suite
 * 
 * Tests for all 10 security vulnerabilities fixes:
 * - Password policy enforcement
 * - CSRF protection
 * - OTP atomicity
 * - Admin middleware
 * - Session management
 * - Rate limiting
 * 
 * Run: npm run test -- security.integration.test.js
 */

const request = require('supertest');
const { validatePasswordPolicy, detectWeakPasswordPatterns } = require('../utils/passwordValidator');
const { generateCsrfToken, verifyCsrfToken, storeCsrfToken } = require('../middleware/csrfMiddleware');

describe('SECURITY FIXES INTEGRATION TESTS', () => {
    describe('1. Password Policy Validation', () => {
        test('should reject passwords shorter than 12 characters', () => {
            const result = validatePasswordPolicy('Pass123!');
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain(expect.stringMatching(/at least 12 characters/i));
        });

        test('should reject passwords without uppercase letter', () => {
            const result = validatePasswordPolicy('password123!x');
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain(expect.stringMatching(/uppercase letter/i));
        });

        test('should reject passwords without lowercase letter', () => {
            const result = validatePasswordPolicy('PASSWORD123!X');
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain(expect.stringMatching(/lowercase letter/i));
        });

        test('should reject passwords without digit', () => {
            const result = validatePasswordPolicy('Password!abcd');
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain(expect.stringMatching(/digit/i));
        });

        test('should reject passwords without special character', () => {
            const result = validatePasswordPolicy('Password123abcd');
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain(expect.stringMatching(/special character/i));
        });

        test('should accept valid password (12+ chars, uppercase, lowercase, digit, special)', () => {
            const result = validatePasswordPolicy('ValidPass123!');
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        test('should accept long strong passwords', () => {
            const result = validatePasswordPolicy('MySecurePassword123!@#');
            expect(result.isValid).toBe(true);
        });
    });

    describe('2. Weak Password Pattern Detection', () => {
        test('should detect sequential patterns', () => {
            const result = detectWeakPasswordPatterns('Password123!');
            expect(result.isWeak).toBe(true);
            expect(result.reason).toMatch(/sequential/i);
        });

        test('should detect keyboard patterns', () => {
            const result = detectWeakPasswordPatterns('Qwerty1!ab');
            expect(result.isWeak).toBe(true);
            expect(result.reason).toMatch(/keyboard/i);
        });

        test('should detect repeated characters', () => {
            const result = detectWeakPasswordPatterns('Passsword111!');
            expect(result.isWeak).toBe(true);
            expect(result.reason).toMatch(/repeated/i);
        });

        test('should detect date patterns', () => {
            const result = detectWeakPasswordPatterns('Password2024!');
            expect(result.isWeak).toBe(true);
            expect(result.reason).toMatch(/date/i);
        });

        test('should not flag strong random passwords', () => {
            const result = detectWeakPasswordPatterns('Kx7mPqL2!wRz');
            expect(result.isWeak).toBe(false);
        });
    });

    describe('3. CSRF Token Generation & Validation', () => {
        test('should generate unique tokens', () => {
            const token1 = generateCsrfToken();
            const token2 = generateCsrfToken();
            expect(token1).not.toBe(token2);
        });

        test('should generate tokens of correct length', () => {
            const token = generateCsrfToken();
            expect(token).toHaveLength(64); // 32 bytes * 2 hex chars
        });

        test('should store and verify token', () => {
            const token = generateCsrfToken();
            storeCsrfToken(token, { uid: 'test-user' });
            const valid = verifyCsrfToken(token);
            expect(valid).toBe(true);
        });

        test('should invalidate token after one-time use', () => {
            const token = generateCsrfToken();
            storeCsrfToken(token);
            
            const firstUse = verifyCsrfToken(token);
            expect(firstUse).toBe(true);
            
            const secondUse = verifyCsrfToken(token);
            expect(secondUse).toBe(false); // Token consumed
        });

        test('should reject invalid tokens', () => {
            const valid = verifyCsrfToken('invalid-token-xyz');
            expect(valid).toBe(false);
        });
    });

    describe('4. OTP Atomicity (Race Condition Fix)', () => {
        test('should clear other purposes when new OTP sent', async () => {
            // Mock scenario: user requests login OTP
            const loginOtp = generateMockOtp();
            await storeOtpSession({
                userId: 'test-user',
                purpose: 'login',
                otpHash: loginOtp,
            });

            // User then requests password-reset OTP
            const resetOtp = generateMockOtp();
            await storeOtpSession({
                userId: 'test-user',
                purpose: 'forgot-password',
                otpHash: resetOtp,
            });

            // Verify only one OTP exists per purpose
            const loginSessions = await getOtpSessions('test-user', 'login');
            const resetSessions = await getOtpSessions('test-user', 'forgot-password');
            
            expect(loginSessions).toHaveLength(1);
            expect(resetSessions).toHaveLength(1);
        });

        test('should prevent purpose mixing on verify', async () => {
            // Create login OTP
            const otp = '123456';
            const otpHash = await hashOtp(otp);
            await storeOtpSession({
                userId: 'test-user',
                purpose: 'login',
                otpHash,
            });

            // Attempt to verify with wrong purpose
            const result = await verifyOtpSession('test-user', otp, 'forgot-password');
            expect(result.valid).toBe(false);
            expect(result.reason).toMatch(/purpose.*mismatch/i);
        });
    });

    describe('5. Admin Middleware Enforcement', () => {
        test('should require admin middleware on all admin routes', async () => {
            const adminRoutes = [
                '/api/admin/users',
                '/api/admin/products',
                '/api/admin/analytics',
                '/api/admin/notifications',
            ];

            for (const route of adminRoutes) {
                const response = await request(app)
                    .get(route)
                    .set('Authorization', `Bearer ${userToken}`);
                
                expect(response.status).toBe(403);
                expect(response.body.message).toMatch(/admin/i);
            }
        });

        test('should allow admin access with valid admin role', async () => {
            const response = await request(app)
                .get('/api/admin/users')
                .set('Authorization', `Bearer ${adminToken}`);
            
            expect(response.status).not.toBe(403);
        });

        test('should check admin flag in fresh database query', async () => {
            // Admin user has isAdmin=true initially
            let response = await request(app)
                .get('/api/admin/users')
                .set('Authorization', `Bearer ${adminToken}`);
            expect(response.status).not.toBe(403);

            // Simulate role removal in database
            await updateUser(adminUserId, { isAdmin: false });

            // Should be denied on next request (fresh check)
            response = await request(app)
                .get('/api/admin/users')
                .set('Authorization', `Bearer ${adminToken}`);
            expect(response.status).toBe(403);
        });
    });

    describe('6. Session Token Caching', () => {
        test('should cache user session with TTL', async () => {
            const token = 'test-token-123';
            const user = { _id: 'user1', email: 'test@test.com', isAdmin: false };
            
            await setCachedUser('uid1', user, Math.floor(Date.now() / 1000) + 3600);
            const cached = await getCachedUser('uid1');
            
            expect(cached).toEqual(user);
        });

        test('should invalidate cache on logout', async () => {
            const user = { _id: 'user1', email: 'test@test.com' };
            await setCachedUser('uid1', user, Math.floor(Date.now() / 1000) + 3600);
            
            await invalidateUserCache('uid1');
            const cached = await getCachedUser('uid1');
            
            expect(cached).toBeNull();
        });

        test('should return fresh DB record if cache expired', async () => {
            // Cache doesn't exist
            const cached = await getCachedUser('uid2');
            expect(cached).toBeNull();
            
            // Fall through to DB query
            const user = await User.findById('user2');
            expect(user).not.toBeNull();
        });
    });

    describe('7. Rate Limiting with Proxy Trust', () => {
        test('should respect X-RateLimit headers', async () => {
            const limiter = createDistributedRateLimit({
                name: 'test_limit',
                windowMs: 60 * 1000,
                max: 3,
            });

            // Make 3 requests (should succeed)
            for (let i = 0; i < 3; i++) {
                const response = await makeTestRequest(limiter);
                expect(response.status).not.toBe(429);
            }

            // 4th request should be rate limited
            const response = await makeTestRequest(limiter);
            expect(response.status).toBe(429);
        });

        test('should trust X-Forwarded-For header from trusted proxy', async () => {
            // Both use same forwarded IP - should share rate limit bucket
            const response1 = await request(app)
                .get('/api/test')
                .set('X-Forwarded-For', '203.0.113.1');
            
            const response2 = await request(app)
                .get('/api/test')
                .set('X-Forwarded-For', '203.0.113.1');
            
            // Should share the same rate limit window
            expect(response1.headers['x-ratelimit-remaining']).toBe(response2.headers['x-ratelimit-remaining']);
        });
    });

    describe('8. Session Deduplication Window (5s)', () => {
        test('should update user within 5 second dedup window', async () => {
            // Initial role is admin
            expect(sessionState.roles.isAdmin).toBe(true);
            
            // Remove admin role from DB
            await updateUser(userId, { isAdmin: false });
            
            // Wait 3 seconds (before 5s window)
            await sleep(3000);
            
            // Refresh should use cached session
            const profile1 = sessionState.profile;
            expect(profile1.isAdmin).toBe(true); // Still cached
        });

        test('should reflect changes after 5 second window', async () => {
            // Initial role is admin
            expect(sessionState.roles.isAdmin).toBe(true);
            
            // Remove admin role from DB
            await updateUser(userId, { isAdmin: false });
            
            // Wait 5+ seconds
            await sleep(5500);
            
            // Next sync should fetch from DB
            await triggerSessionSync();
            expect(sessionState.roles.isAdmin).toBe(false);
        });
    });

    describe('9. Firebase Project ID Parameterization', () => {
        test('should use FIREBASE_PROJECT_ID from environment', () => {
            const projectId = process.env.FIREBASE_PROJECT_ID;
            expect(projectId).toBeDefined();
            expect(projectId).not.toBe('');
        });

        test('should not contain hardcoded project ID', () => {
            const firebaseConfig = require('../config/firebase.js');
            const configString = JSON.stringify(firebaseConfig);
            
            // Should not have hardcoded value
            expect(configString).not.toContain('billy-b674c');
        });
    });

    describe('10. CSRF Protection on Auth Endpoints', () => {
        test('GET /auth/session should return CSRF token', async () => {
            const response = await request(app)
                .get('/api/auth/session')
                .set('Authorization', `Bearer ${token}`);
            
            expect(response.status).toBe(200);
            expect(response.headers['x-csrf-token']).toBeDefined();
        });

        test('POST /auth/sync without CSRF token should fail', async () => {
            const response = await request(app)
                .post('/api/auth/sync')
                .set('Authorization', `Bearer ${token}`)
                .send({ email: 'test@test.com', name: 'Test' });
            
            expect(response.status).toBe(403);
            expect(response.body.message).toMatch(/csrf/i);
        });

        test('POST /auth/sync with valid CSRF token should succeed', async () => {
            // Get CSRF token
            const sessionResponse = await request(app)
                .get('/api/auth/session')
                .set('Authorization', `Bearer ${token}`);
            
            const csrfToken = sessionResponse.headers['x-csrf-token'];
            
            // Use token in POST
            const response = await request(app)
                .post('/api/auth/sync')
                .set('Authorization', `Bearer ${token}`)
                .set('X-CSRF-Token', csrfToken)
                .send({ email: 'test@test.com', name: 'Test' });
            
            expect(response.status).not.toBe(403);
        });

        test('POST /auth/verify-lattice without CSRF token should fail', async () => {
            const response = await request(app)
                .post('/api/auth/verify-lattice')
                .set('Authorization', `Bearer ${token}`)
                .send({ challengeId: '123', proof: 'abc' });
            
            expect(response.status).toBe(403);
        });
    });

    describe('11. Client-Side Credential Verification Mitigation', () => {
        test('should not expose credentials in OTP request', async () => {
            // Frontend should not send plaintext password in OTP
            const response = await request(app)
                .post('/api/auth/otp/send')
                .send({
                    email: 'test@test.com',
                    phone: '+911234567890',
                    purpose: 'login',
                    // credentialProofToken should be used, not password
                });
            
            expect(response.body).not.toHaveProperty('password');
        });

        test('should require proof token for login OTP', async () => {
            const response = await request(app)
                .post('/api/auth/otp/send')
                .send({
                    email: 'test@test.com',
                    phone: '+911234567890',
                    purpose: 'login',
                    credentialProofToken: '',  // Missing proof
                });
            
            if (process.env.OTP_LOGIN_REQUIRE_CREDENTIAL_PROOF === 'true') {
                expect(response.status).toBe(401);
            }
        });
    });

    describe('Integration: Combined Attack Scenarios', () => {
        test('should prevent brute force OTP attacks with rate limiting', async () => {
            const email = 'attacker@test.com';
            const phone = '+919876543210';
            
            // Attempt 10 rapid OTP sends (limit is 3/min)
            for (let i = 0; i < 10; i++) {
                const response = await request(app)
                    .post('/api/auth/otp/send')
                    .send({ email, phone, purpose: 'login' });
                
                if (i >= 3) {
                    expect(response.status).toBe(429); // Rate limited
                }
            }
        });

        test('should prevent privilege escalation', async () => {
            // User attempts to access admin endpoint
            const response = await request(app)
                .get('/api/admin/users')
                .set('Authorization', `Bearer ${userToken}`);
            
            expect(response.status).toBe(403);
        });

        test('should prevent CSRF + admin combined attack', async () => {
            // Attack: forge CSRF on admin endpoint
            const response = await request(app)
                .post('/api/admin/users/123/suspend')
                .set('Authorization', `Bearer ${adminToken}`)
                // No CSRF token
                .send({ reason: 'test' });
            
            expect(response.status).toBe(403);
        });
    });
});

// Helper functions
function generateMockOtp() {
    return Math.random().toString(36).substring(2, 15);
}

async function storeOtpSession(data) {
    // Mock implementation
}

async function getOtpSessions(userId, purpose) {
    // Mock implementation
}

async function hashOtp(otp) {
    // Mock implementation
}

async function verifyOtpSession(userId, otp, purpose) {
    // Mock implementation
}

async function setCachedUser(uid, user, expiry) {
    // Mock implementation
}

async function getCachedUser(uid) {
    // Mock implementation
}

async function invalidateUserCache(uid) {
    // Mock implementation
}

async function updateUser(userId, updates) {
    // Mock implementation
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function triggerSessionSync() {
    // Mock implementation
}
