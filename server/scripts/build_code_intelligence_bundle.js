const fs = require('fs');
const path = require('path');
const { buildCodeIntelligenceBundle } = require('../services/intelligence/codeIntelligenceBuilder');

const OUTPUT_DIRECTORY = path.resolve(__dirname, '..', 'generated', 'intelligence', 'current');
const OUTPUT_FILE = path.join(OUTPUT_DIRECTORY, 'bundle.json');

const main = () => {
    const bundle = buildCodeIntelligenceBundle({
        commitSha: process.env.GITHUB_SHA || process.env.APP_BUILD_SHA || 'dev-local',
    });

    fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(bundle, null, 2));

    console.log(JSON.stringify({
        status: 'ok',
        output: OUTPUT_FILE,
        commitSha: bundle.commitSha,
        files: bundle.files.length,
        chunks: bundle.chunks.length,
        routes: bundle.routeMap.length,
        models: bundle.modelMap.length,
        graphNodes: bundle.graph?.nodes?.length || 0,
        graphEdges: bundle.graph?.edges?.length || 0,
    }));
};

main();
