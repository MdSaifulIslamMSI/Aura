require('dotenv').config();

const { generateDemoCatalogSnapshot } = require('../services/demoCatalogSnapshotService');

const run = async () => {
    const result = await generateDemoCatalogSnapshot();
    console.log(JSON.stringify({
        total: result.total,
        sourceRef: result.sourceRef,
        manifestRef: result.manifestRef,
        catalogVersion: result.catalogVersion,
        note: 'Synthetic demo catalog only. This snapshot is blocked from production publish.',
    }, null, 2));
};

run().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
});
