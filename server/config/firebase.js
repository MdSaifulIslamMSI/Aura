const admin = require('firebase-admin');
require('colors');
const logger = require('../utils/logger');

const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';
const isPlaceholder = (value) => {
    const normalized = String(value || '').trim();
    return /^<[^>]+>$/.test(normalized) || /^kv:/i.test(normalized);
};
const readEnv = (name) => {
    const value = process.env[name];
    if (isBlank(value) || isPlaceholder(value)) {
        return '';
    }
    return String(value).trim();
};

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test' || process.argv.includes('--test');
const isE2eTest = process.argv.some((arg) => arg.includes('playwright') || arg.includes('e2e'));

const buildProjectIdFallback = () => {
    if (isTest || isE2eTest) {
        console.warn('Using test Firebase project ID for testing: test-project-dev');
        return 'test-project-dev';
    }

    console.warn('FIREBASE_PROJECT_ID not explicitly set. Using local development fallback.');
    return 'dev-project-local';
};

const tryBuildCredentialFromServiceAccount = () => {
    const raw = readEnv('FIREBASE_SERVICE_ACCOUNT');
    if (!raw) return { credential: null, projectId: '', source: '' };

    try {
        const serviceAccount = JSON.parse(raw);
        return {
            credential: admin.credential.cert(serviceAccount),
            projectId: String(serviceAccount.project_id || '').trim(),
            source: 'FIREBASE_SERVICE_ACCOUNT',
        };
    } catch (error) {
        logger.error('firebase.sa_parse_failed', { error: error.message });
        throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT JSON env var');
    }
};

const tryBuildCredentialFromDiscreteFields = (projectId) => {
    const clientEmail = readEnv('FIREBASE_CLIENT_EMAIL');
    const privateKey = readEnv('FIREBASE_PRIVATE_KEY');

    if (!clientEmail || !privateKey || !projectId) {
        return { credential: null, source: '' };
    }

    return {
        credential: admin.credential.cert({
            projectId,
            clientEmail,
            privateKey: privateKey.replace(/\\n/g, '\n'),
        }),
        source: 'discrete_fields',
    };
};

try {
    let projectId = readEnv('FIREBASE_PROJECT_ID');
    let credential = null;
    let credentialSource = '';

    const serviceAccountResult = tryBuildCredentialFromServiceAccount();
    if (serviceAccountResult.credential) {
        credential = serviceAccountResult.credential;
        credentialSource = serviceAccountResult.source;
        projectId = serviceAccountResult.projectId || projectId;
    } else {
        const discreteFieldsResult = tryBuildCredentialFromDiscreteFields(projectId);
        credential = discreteFieldsResult.credential;
        credentialSource = discreteFieldsResult.source;
    }

    if (!projectId) {
        if (credential && !isProduction) {
            logger.warn('firebase.project_id_missing_with_credential', {
                reason: 'using_fallback_project_id_for_non_prod',
            });
        }
        projectId = buildProjectIdFallback();
    }

    if (isProduction && !credential) {
        const errorMsg =
            'FATAL: Firebase Admin credentials are missing in production.\n'
            + 'Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.';

        console.error('\n' + '='.repeat(70));
        console.error('FIREBASE INITIALIZATION FAILED - PRODUCTION MODE');
        console.error('='.repeat(70));
        console.error(errorMsg);
        console.error('='.repeat(70) + '\n');

        logger.error('firebase.init_failed', {
            error: 'Credentials missing in production',
            hint: 'Set FIREBASE_SERVICE_ACCOUNT or discrete Firebase Admin credentials',
        });

        process.exit(1);
    }

    const appOptions = { projectId };
    if (credential) {
        appOptions.credential = credential;
        logger.info('firebase.cert_init', { source: credentialSource });
    } else if (isProduction) {
        logger.warn('firebase.initialized_without_admin_credential', {
            projectId,
            reason: 'credential_unavailable',
        });
    }

    admin.initializeApp(appOptions);

    logger.info('firebase.initialized', {
        projectId,
        environment: isProduction ? 'production' : isTest ? 'test' : 'development',
        hasCredential: Boolean(credential),
    });
} catch (error) {
    if (error.code === 'app/duplicate-app') {
        logger.info('firebase.already_initialized');
    } else {
        console.error('\n' + '='.repeat(70));
        console.error('FIREBASE INITIALIZATION ERROR');
        console.error('='.repeat(70));
        console.error('Error:', error.message);
        console.error('='.repeat(70) + '\n');

        logger.error('firebase.init_failed', {
            error: error.message,
            code: error.code,
            hint: 'Check FIREBASE_SERVICE_ACCOUNT and credentials',
        });

        if (isProduction) {
            process.exit(1);
        }
    }
}

module.exports = admin;
