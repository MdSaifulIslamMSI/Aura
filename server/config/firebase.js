const admin = require('firebase-admin');
require('colors');
const logger = require('../utils/logger');

try {
    // Attempt to initialize with Application Default Credentials
    // or infer from environment
    const projectId = process.env.FIREBASE_PROJECT_ID || 'billy-b674c';
    admin.initializeApp({
        projectId
    });
    logger.info('firebase.initialized', { projectId });
} catch (error) {
    if (error.code === 'app/duplicate-app') {
        logger.info('firebase.already_initialized');
    } else {
        logger.error('firebase.init_failed', { error: error.message });
    }
}

module.exports = admin;
