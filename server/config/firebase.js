const admin = require('firebase-admin');
require('colors');
const logger = require('../utils/logger');

try {
    // Attempt to initialize with Application Default Credentials
    // or infer from environment
    admin.initializeApp({
        projectId: 'billy-b674c' // From frontend config
    });
    logger.info('firebase.initialized', { projectId: 'billy-b674c' });
} catch (error) {
    if (error.code === 'app/duplicate-app') {
        logger.info('firebase.already_initialized');
    } else {
        logger.error('firebase.init_failed', { error: error.message });
    }
}

module.exports = admin;
