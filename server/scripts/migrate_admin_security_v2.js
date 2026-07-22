/* eslint-disable no-console */
const mongoose = require('mongoose');
const { loadLocalEnvFiles } = require('../config/runtimeConfig');

loadLocalEnvFiles();

const AdminRecoveryGrant = require('../models/AdminRecoveryGrant');
const AdminSecurityAuditLog = require('../models/AdminSecurityAuditLog');
const User = require('../models/User');

const args = new Set(process.argv.slice(2).map((entry) => String(entry || '').trim()));
const execute = args.has('--execute');
const getArg = (name) => {
    const prefix = `${name}=`;
    const inline = [...args].find((entry) => entry.startsWith(prefix));
    return inline ? inline.slice(prefix.length).trim() : '';
};

const main = async () => {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
    await mongoose.connect(process.env.MONGO_URI);

    const missingVersionCount = await User.countDocuments({ adminSecurityVersion: { $exists: false } });
    const currentGrantIndexes = await AdminRecoveryGrant.collection.indexes().catch(() => []);
    const currentAuditIndexes = await AdminSecurityAuditLog.collection.indexes().catch(() => []);
    const report = {
        mode: execute ? 'apply' : 'audit',
        missingAdminSecurityVersion: missingVersionCount,
        recoveryGrantIndexes: currentGrantIndexes.map((index) => index.name).sort(),
        auditLogIndexes: currentAuditIndexes.map((index) => index.name).sort(),
    };

    if (!execute) {
        console.log(JSON.stringify(report, null, 2));
        console.log('Audit only. Re-run with --execute --approved-by=<operator> --ticket=<ticket> after backup/restore evidence is approved.');
        return;
    }

    const approvedBy = getArg('--approved-by');
    const ticket = getArg('--ticket');
    if (!approvedBy || !ticket) {
        throw new Error('--execute requires --approved-by=<operator> and --ticket=<ticket>');
    }

    const versionBackfill = await User.updateMany(
        { adminSecurityVersion: { $exists: false } },
        { $set: { adminSecurityVersion: 0 } }
    );
    await AdminRecoveryGrant.createIndexes();
    await AdminSecurityAuditLog.createIndexes();
    console.log(JSON.stringify({
        mode: 'apply',
        matchedUsers: Number(versionBackfill.matchedCount || 0),
        modifiedUsers: Number(versionBackfill.modifiedCount || 0),
        approvedBy,
        ticket,
        additiveOnly: true,
    }, null, 2));
};

main()
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => {});
    });
