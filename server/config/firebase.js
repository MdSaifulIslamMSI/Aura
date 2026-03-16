const admin = require('firebase-admin');
require('colors');
const logger = require('../utils/logger');

try {
    // CRITICAL: FIREBASE_PROJECT_ID must be explicitly set
    // No fallback to hardcoded value
    const projectId = process.env.FIREBASE_PROJECT_ID;
    
    if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
        const errorMsg = 
            'FATAL: FIREBASE_PROJECT_ID environment variable is not set or is empty.\n' +
            'This is required to initialize Firebase Admin SDK.\n' +
            'Please set FIREBASE_PROJECT_ID in your .env file or deployment platform\n' +
            'before starting the application.\n' +
            'Example: FIREBASE_PROJECT_ID=my-firebase-project';
        
        console.error('\n' + '='.repeat(70));
        console.error('🔴 FIREBASE INITIALIZATION FAILED');
        console.error('='.repeat(70));
        console.error(errorMsg);
        console.error('='.repeat(70) + '\n');
        
        logger.error('firebase.init_failed', {
            error: 'FIREBASE_PROJECT_ID not set',
            hint: 'Set FIREBASE_PROJECT_ID environment variable'
        });
        
        process.exit(1);
    }

    admin.initializeApp({
        projectId: projectId.trim()
    });
    
    logger.info('firebase.initialized', { projectId: projectId.trim() });
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
        
        process.exit(1);
    }
}

module.exports = admin;
