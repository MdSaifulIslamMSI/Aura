#!/usr/bin/env node

const { loadLocalEnvFiles } = require('../config/runtimeConfig');
const connectDB = require('../config/db');
const { seedDefaultStatusCatalog } = require('../services/statusService');

loadLocalEnvFiles();

const main = async () => {
    await connectDB();
    const includeDemoMetrics = process.argv.includes('--demo-metrics')
        || (process.env.NODE_ENV !== 'production' && !process.argv.includes('--no-demo-metrics'));
    const result = await seedDefaultStatusCatalog({ includeDemoMetrics });
    console.log(JSON.stringify({
        ok: true,
        includeDemoMetrics,
        ...result,
    }, null, 2));
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error?.stack || error?.message || error);
        process.exit(1);
    });
