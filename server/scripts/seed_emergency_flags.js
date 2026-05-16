require('colors');

const mongoose = require('mongoose');
const { loadLocalEnvFiles } = require('../config/runtimeConfig');
const connectDB = require('../config/db');
const EmergencyControl = require('../models/EmergencyControl');
const {
    DEFAULT_EMERGENCY_FLAGS,
    EMERGENCY_FLAG_KEYS,
} = require('../config/emergencyControlConstants');

loadLocalEnvFiles();

const seedEmergencyFlags = async () => {
    await connectDB();

    let created = 0;
    let updated = 0;

    for (const key of EMERGENCY_FLAG_KEYS) {
        const defaults = DEFAULT_EMERGENCY_FLAGS[key];
        const result = await EmergencyControl.updateOne(
            { key },
            {
                $setOnInsert: {
                    key,
                    enabled: false,
                    severity: defaults.severity,
                    scope: defaults.scope,
                    userMessage: defaults.userMessage,
                    internalReason: '',
                    requiresDualApproval: false,
                    startsAt: null,
                    expiresAt: null,
                    metadata: {},
                },
            },
            { upsert: true }
        );

        if (result.upsertedCount > 0) created += 1;
        else updated += result.modifiedCount || 0;
    }

    console.log(`Emergency flags seeded. created=${created} updated=${updated} total=${EMERGENCY_FLAG_KEYS.length}`.green);
};

seedEmergencyFlags()
    .catch((error) => {
        console.error('Failed to seed emergency flags'.red, error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close().catch(() => {});
    });
