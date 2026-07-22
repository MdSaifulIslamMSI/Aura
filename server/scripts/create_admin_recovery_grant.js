/* eslint-disable no-console */
const readline = require('readline/promises');
const mongoose = require('mongoose');
const { loadLocalEnvFiles } = require('../config/runtimeConfig');

loadLocalEnvFiles();

const User = require('../models/User');
const AdminRecoveryGrant = require('../models/AdminRecoveryGrant');
const { validateAdminSecurityConfig } = require('../config/adminSecurityConfig');
const {
    createAdminRecoveryGrant,
    hmacSecurityValue,
    recordAdminSecurityAudit,
} = require('../services/adminRecoveryGrantService');
const { isAllowlistedAdmin } = require('../services/adminSecurityStateService');

const parseArgs = (argv = []) => {
    const values = {};
    for (let index = 0; index < argv.length; index += 1) {
        const current = String(argv[index] || '');
        if (!current.startsWith('--')) continue;
        const [rawKey, inlineValue] = current.slice(2).split('=', 2);
        const next = argv[index + 1];
        values[rawKey] = inlineValue !== undefined
            ? inlineValue
            : (next && !String(next).startsWith('--') ? argv[++index] : true);
    }
    return values;
};

const parseDurationSeconds = (value = '10m') => {
    const match = String(value || '').trim().toLowerCase().match(/^(\d+)(s|m)$/);
    if (!match) throw new Error('--expires-in must use seconds or minutes, for example 10m');
    const amount = Number(match[1]);
    const seconds = match[2] === 'm' ? amount * 60 : amount;
    if (seconds < 60 || seconds > 30 * 60) {
        throw new Error('--expires-in must be between 60 seconds and 30 minutes');
    }
    return seconds;
};

const requireText = (args, key) => {
    const value = String(args[key] || '').trim();
    if (!value) throw new Error(`--${key} is required`);
    return value;
};

const confirmIssue = async (args, summary) => {
    if (String(args.confirm || '').trim() === 'ISSUE') return;
    if (!process.stdin.isTTY) {
        throw new Error('Non-interactive use requires --confirm ISSUE');
    }
    const prompt = readline.createInterface({ input: process.stdin, output: process.stderr });
    try {
        const answer = await prompt.question('Type ISSUE to create this one-time production recovery grant: ');
        if (String(answer || '').trim() !== 'ISSUE') throw new Error('Grant creation cancelled');
    } finally {
        prompt.close();
    }
};

const main = async () => {
    const args = parseArgs(process.argv.slice(2));
    const validation = validateAdminSecurityConfig();
    if (!validation.safe || !validation.config.recoveryGrants || !validation.config.passkeyEnrollment) {
        throw new Error(`Admin recovery is not safely enabled: ${validation.failures.join('; ') || 'feature flags are disabled'}`);
    }
    if (String(args.method || 'passkey').trim().toLowerCase() !== 'passkey') {
        throw new Error('Only --method passkey is supported');
    }

    const operator = requireText(args, 'operator');
    const reasonCode = requireText(args, 'reason');
    const ticket = requireText(args, 'ticket');
    const secondOperator = String(args['second-operator'] || '').trim();
    if (validation.config.twoPersonRecoveryRequired) {
        if (!secondOperator) throw new Error('--second-operator is required by production policy');
        if (hmacSecurityValue(operator) === hmacSecurityValue(secondOperator)) {
            throw new Error('The second recovery operator must be distinct');
        }
    }
    const expiresInSeconds = parseDurationSeconds(args['expires-in'] || '10m');
    const userId = String(args['user-id'] || '').trim();
    const authUid = String(args['auth-uid'] || '').trim();
    if (!userId && !authUid) throw new Error('--user-id or --auth-uid is required');
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');

    await mongoose.connect(process.env.MONGO_URI);
    const user = await User.findOne(userId ? { _id: userId } : { authUid })
        .select('_id email authUid isAdmin adminRoles isVerified accountState softDeleted adminSecurityVersion')
        .lean();
    if (!user || !user.isVerified || user.softDeleted || ['suspended', 'deleted'].includes(String(user.accountState || '').toLowerCase())) {
        throw new Error('Recovery subject must be an active verified user');
    }
    if (!isAllowlistedAdmin(user)) {
        throw new Error('Recovery subject must be an allowlisted admin');
    }

    const summary = {
        action: 'create_admin_recovery_grant',
        subjectHash: hmacSecurityValue(String(user._id)),
        emailHash: hmacSecurityValue(user.email),
        method: 'passkey',
        expiresInSeconds,
        reasonCode,
        ticketHash: hmacSecurityValue(ticket),
        twoPersonApproved: Boolean(secondOperator),
        adminSecurityVersion: Number(user.adminSecurityVersion || 0),
    };
    console.error(JSON.stringify(summary, null, 2));
    await confirmIssue(args, summary);

    const { grant, plaintextToken } = await createAdminRecoveryGrant({
        user,
        operator,
        secondOperator,
        ticket,
        reasonCode,
        expiresInSeconds,
    });
    try {
        await recordAdminSecurityAudit({
            event: 'admin_recovery_grant_issued',
            outcome: 'issued',
            reasonCode,
            subjectUser: user._id,
            grantId: grant.grantId,
            metadata: {
                method: 'passkey',
                expiresAt: grant.expiresAt,
                twoPersonApproved: Boolean(secondOperator),
            },
        });
    } catch (error) {
        await AdminRecoveryGrant.updateOne(
            { _id: grant._id, state: 'active' },
            { $set: { state: 'revoked', revokedAt: new Date() } }
        ).catch(() => {});
        throw new Error('Grant issuance audit failed; the grant was revoked and no plaintext was released');
    }

    console.error(`Issued one-time admin recovery grant ${grant.grantId}. The plaintext below will not be stored or shown again.`);
    process.stdout.write(`${plaintextToken}\n`);
};

main()
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => {});
    });
