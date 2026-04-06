const admin = require('firebase-admin');
require('colors');
const logger = require('../utils/logger');

try {
    // CRITICAL: FIREBASE_PROJECT_ID validation with environment awareness
    let projectId = process.env.FIREBASE_PROJECT_ID;
    const isProduction = process.env.NODE_ENV === 'production';
    const isTest = process.env.NODE_ENV === 'test' || process.argv.includes('--test');
    const isE2eTest = process.argv.some(arg => arg.includes('playwright') || arg.includes('e2e'));
    
    // ── Production Credential Resolution ─────────────────────────────────────
    let credential = null;
    
    if (isProduction) {
        // Option 1: Full JSON string
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            try {
                const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
                credential = admin.credential.cert(sa);
                projectId = sa.project_id || projectId;
                logger.info('firebase.cert_init', { source: 'FIREBASE_SERVICE_ACCOUNT' });
            } catch (err) {
                logger.error('firebase.sa_parse_failed', { error: err.message });
                if (projectId && typeof projectId === 'string' && projectId.trim() !== '') {
                    logger.warn('firebase.cert_init_degraded', {
                        source: 'FIREBASE_SERVICE_ACCOUNT',
                        projectId: projectId.trim(),
                        reason: 'sa_parse_failed',
                    });
                } else {
                    throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT JSON env var');
                }
            }
        } 
        // Option 2: Discrete fields
        else if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
            credential = admin.credential.cert({
                projectId: projectId,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            });
            logger.info('firebase.cert_init', { source: 'discrete_fields' });
        }
    }

    // Validation for production
    if (isProduction && !credential && (!projectId || typeof projectId !== 'string' || projectId.trim() === '')) {
        const errorMsg = 
            'FATAL: FIREBASE_PROJECT_ID or FIREBASE_SERVICE_ACCOUNT is not set.\n' +
            'This is required to initialize Firebase Admin SDK in production.\n' +
            'Please set FIREBASE_SERVICE_ACCOUNT (JSON) in your Render environment variables.';
        
        console.error('\n' + '='.repeat(70));
        console.error('🔴 FIREBASE INITIALIZATION FAILED - PRODUCTION MODE');
        console.error('='.repeat(70));
        console.error(errorMsg);
        console.error('='.repeat(70) + '\n');
        
        logger.error('firebase.init_failed', {
            error: 'Credentials missing in production',
            hint: 'Set FIREBASE_SERVICE_ACCOUNT'
        });
        
        process.exit(1);
    }
    
    // ── Fallback Resolution for Non-Prod ─────────────────────────────────────
    if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
        if (isTest || isE2eTest) {
            projectId = 'test-project-dev';
            console.warn('⚠️  Using test Firebase project ID for testing: test-project-dev');
        } else {
            projectId = 'dev-project-local';
            console.warn('⚠️  FIREBASE_PROJECT_ID not explicitly set. Using local development fallback.');
        }
    }

    const appOptions = {
        projectId: projectId.trim()
    };

    if (credential) {
        appOptions.credential = credential;
    } else if (isProduction) {
        logger.warn('firebase.initialized_without_admin_credential', {
            projectId: projectId.trim(),
            reason: 'credential_unavailable',
        });
    }

    admin.initializeApp(appOptions);
    
    logger.info('firebase.initialized', { 
        projectId: projectId.trim(), 
        environment: isProduction ? 'production' : isTest ? 'test' : 'development',
        hasCredential: Boolean(credential)
    });
} catch (error) {
    if (error.code === 'app/duplicate-app') {
        logger.info('firebase.already_initialized');
    } else {
        console.error('\n' + '='.repeat(70));
        console.error('🔴 FIREBASE INITIALIZATION ERROR');
        console.error('='.repeat(70));
        console.error('Error:', error.message);
        console.error('='.repeat(70) + '\n');
        
        logger.error('firebase.init_failed', {
            error: error.message,
            code: error.code,
            hint: 'Check FIREBASE_SERVICE_ACCOUNT and credentials'
        });
        
        // In production, fail hard
        if (process.env.NODE_ENV === 'production') {
            process.exit(1);
        }
    }
}

module.exports = admin;
