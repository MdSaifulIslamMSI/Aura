/* eslint-disable no-console */
require('dotenv').config();

const firebaseAdmin = require('../config/firebase');

const BATCH_SIZE = 1000;

const listAllUsers = async () => {
    const users = [];
    let pageToken;

    do {
        const result = await firebaseAdmin.auth().listUsers(BATCH_SIZE, pageToken);
        users.push(...result.users);
        pageToken = result.pageToken;
    } while (pageToken);

    return users;
};

const main = async () => {
    const users = await listAllUsers();
    const allUids = users.map((user) => user.uid);
    let deletedCount = 0;
    let failureCount = 0;

    for (let i = 0; i < allUids.length; i += BATCH_SIZE) {
        const chunk = allUids.slice(i, i + BATCH_SIZE);
        const result = await firebaseAdmin.auth().deleteUsers(chunk);
        deletedCount += Number(result.successCount || 0);
        failureCount += Number(result.failureCount || 0);
    }

    const remaining = await listAllUsers();

    console.log(JSON.stringify({
        projectId: firebaseAdmin.app().options.projectId || 'unknown',
        usersBefore: allUids.length,
        usersDeleted: deletedCount,
        deleteFailures: failureCount,
        usersRemaining: remaining.length,
        completedAt: new Date().toISOString(),
    }, null, 2));
};

main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
});

