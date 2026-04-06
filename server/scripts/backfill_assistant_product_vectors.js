const dotenv = require('dotenv');
const connectDB = require('../config/db');
const { backfillProductVectorIndex } = require('../services/ai/localProductVectorIndexService');

dotenv.config();

const readFlagValue = (flag) => {
    const index = process.argv.indexOf(flag);
    if (index === -1) return '';
    return String(process.argv[index + 1] || '').trim();
};

const limit = Number(readFlagValue('--limit') || 0);
const force = process.argv.includes('--force');

connectDB()
    .then(async () => {
        const result = await backfillProductVectorIndex({ limit, force });
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
    })
    .catch((error) => {
        console.error(error.message || error);
        process.exit(1);
    });
