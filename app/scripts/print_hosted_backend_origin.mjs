import {
    assertDeployableHostedBackendOrigin,
    resolveHostedBackendOrigin,
} from '../config/vercelRoutingContract.mjs';

const origin = resolveHostedBackendOrigin();
assertDeployableHostedBackendOrigin(origin);
process.stdout.write(origin);
