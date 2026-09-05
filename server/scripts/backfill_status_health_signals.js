#!/usr/bin/env node

const { loadLocalEnvFiles } = require('../config/runtimeConfig');
const connectDB = require('../config/db');
const { backfillStatusHealthSignals } = require('../services/statusService');

loadLocalEnvFiles();

const main = async () => {
    await connectDB();
    const result = await backfillStatusHealthSignals();
    console.log(JSON.stringify({
        ok: true,
        ...result,
    }, null, 2));
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error?.stack || error?.message || error);
        process.exit(1);
    });
