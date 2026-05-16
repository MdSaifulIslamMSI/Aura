import {
    assertDeployableHostedBackendOrigin,
    resolveHostedBackendOrigin,
} from '../config/vercelRoutingContract.mjs';

const origin = resolveHostedBackendOrigin(process.env, { allowCommittedFallback: true });
assertDeployableHostedBackendOrigin(origin);
process.stdout.write(origin);
