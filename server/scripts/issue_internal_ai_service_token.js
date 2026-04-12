const { loadLocalEnvFiles } = require('../config/runtimeConfig');
const {
    issueInternalAiServiceToken,
} = require('../services/internalAiTokenService');

const readArg = (flag) => {
    const prefix = `${flag}=`;
    const match = process.argv.find((entry) => String(entry || '').startsWith(prefix));
    return match ? match.slice(prefix.length) : '';
};

const subject = readArg('--subject') || readArg('--service') || 'authorized_client';
const audience = readArg('--audience') || '';
const ttlSeconds = Number.parseInt(readArg('--ttl'), 10);

try {
    loadLocalEnvFiles();
    const issued = issueInternalAiServiceToken({
        subject,
        audience,
        ttlSeconds: Number.isFinite(ttlSeconds) ? ttlSeconds : undefined,
    });

    process.stdout.write(`${JSON.stringify(issued, null, 2)}\n`);
} catch (error) {
    process.stderr.write(`${error.message || 'Unable to issue internal AI token'}\n`);
    process.exitCode = 1;
}
