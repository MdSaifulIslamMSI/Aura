const firebaseAdmin = require('../../config/firebase');
const AppError = require('../../utils/AppError');
const { resolveAuthEnvironment } = require('../../config/authEnvironment');
const { hasPermission, hasRole } = require('./authorizationService');
const { verifyOidcAccessToken } = require('./oidcTokenVerifier');

const createLegacyAuthContext = (decodedToken = {}) => ({
    provider: 'legacy',
    subject: decodedToken.uid || '',
    authUid: decodedToken.uid || '',
    roles: [],
    identity: null,
    authToken: decodedToken,
});

const mapExternalIdentityToInternalUser = (verifiedContext = {}) => ({
    authUid: verifiedContext.authUid || verifiedContext.authToken?.uid || '',
    email: verifiedContext.identity?.email || verifiedContext.authToken?.email || '',
    name: verifiedContext.identity?.name || verifiedContext.authToken?.name || '',
    emailVerified: Boolean(verifiedContext.identity?.emailVerified || verifiedContext.authToken?.email_verified),
    provider: verifiedContext.provider || 'legacy',
    externalSubject: verifiedContext.subject || '',
});

const createAuthAdapter = ({
    env = process.env,
    oidcVerifier = verifyOidcAccessToken,
} = {}) => {
    const config = resolveAuthEnvironment(env);

    const verifyAccessToken = async (token = '') => {
        if (!token) {
            throw new AppError('Access token is required', 401);
        }

        if (config.provider === 'keycloak') {
            return oidcVerifier({ token, env, config });
        }

        const decodedToken = await firebaseAdmin.auth().verifyIdToken(token, true);
        return createLegacyAuthContext(decodedToken);
    };

    const getCurrentUser = (req = {}) => req.user || null;

    const requireUser = (req = {}) => {
        if (!req.user) {
            throw new AppError('Not authorized', 401);
        }
        return req.user;
    };

    return {
        provider: config.provider,
        config,
        getCurrentUser,
        requireUser,
        requireRole(req = {}, role = '') {
            const user = requireUser(req);
            if (!hasRole(user, role)) {
                throw new AppError('Required role is missing', 403);
            }
            return user;
        },
        requirePermission(req = {}, permission = '') {
            const user = requireUser(req);
            if (!hasPermission(user, permission)) {
                throw new AppError('Required permission is missing', 403);
            }
            return user;
        },
        verifyAccessToken,
        refreshSession: async () => null,
        logout: async () => true,
        getUserClaims(verifiedContext = {}) {
            return verifiedContext.authToken || {};
        },
        mapExternalIdentityToInternalUser,
    };
};

const getAuthAdapter = () => createAuthAdapter();

module.exports = {
    createAuthAdapter,
    createLegacyAuthContext,
    getAuthAdapter,
    mapExternalIdentityToInternalUser,
};
