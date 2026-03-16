const admin = require('firebase-admin');
require('colors');
const logger = require('../utils/logger');

try {
    // CRITICAL: FIREBASE_PROJECT_ID validation with environment awareness
    let projectId = process.env.FIREBASE_PROJECT_ID;
    const isProduction = process.env.NODE_ENV === 'production';
    const isTest = process.env.NODE_ENV === 'test' || process.argv.includes('--test');
    const isE2eTest = process.argv.some(arg => arg.includes('playwright') || arg.includes('e2e'));
    
    // In production: REQUIRE explicit FIREBASE_PROJECT_ID
    if (isProduction && (!projectId || typeof projectId !== 'string' || projectId.trim() === '')) {
        const errorMsg = 
            'FATAL: FIREBASE_PROJECT_ID environment variable is not set or is empty.\n' +
            'This is required to initialize Firebase Admin SDK in production.\n' +
            'Please set FIREBASE_PROJECT_ID in your Vercel environment variables\n' +
            'or your deployment platform before deploying.\n' +
            'Example: FIREBASE_PROJECT_ID=my-firebase-project';
        
        console.error('\n' + '='.repeat(70));
        console.error('🔴 FIREBASE INITIALIZATION FAILED - PRODUCTION MODE');
        console.error('='.repeat(70));
        console.error(errorMsg);
        console.error('='.repeat(70) + '\n');
        
        logger.error('firebase.init_failed', {
            error: 'FIREBASE_PROJECT_ID not set in production',
            hint: 'Set FIREBASE_PROJECT_ID in production environment'
        });
        
        process.exit(1);
    }
    
    // In test/e2e environments: Allow test project ID if not configured
    if ((isTest || isE2eTest) && (!projectId || typeof projectId !== 'string' || projectId.trim() === '')) {
        projectId = 'test-project-dev';
        console.warn('⚠️  Using test Firebase project ID for testing: test-project-dev');
        logger.warn('firebase.test_mode', { projectId });
    } else if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
        // In other environments: Warn but allow with test fallback
        projectId = 'dev-project-local';
        console.warn('⚠️  FIREBASE_PROJECT_ID not explicitly set. Using local development fallback.');
        logger.warn('firebase.dev_mode', { projectId });
    }

    admin.initializeApp({
        projectId: projectId.trim()
    });
    
    logger.info('firebase.initialized', { projectId: projectId.trim(), environment: isProduction ? 'production' : isTest ? 'test' : 'development' });
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
            hint: 'Check FIREBASE_PROJECT_ID and credentials'
        });
        
        // In production, fail hard. In test/dev, allow to continue
        if (process.env.NODE_ENV === 'production') {
            process.exit(1);
        }
    }
}

module.exports = admin;
