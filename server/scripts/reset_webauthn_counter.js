/* eslint-disable no-console */
// Reset the WebAuthn signature counter on a user's trusted-device records.
//
// Why this exists: platform authenticators (Windows Hello / TPM) can reset
// their per-site signature counter after OS security updates, firmware
// events, or Hello re-registration. The assertion verifier correctly treats
// a counter at or below the stored value as a clone signal, which locks the
// account out of device confirmation with
// "WebAuthn signature counter regression detected" even though the
// credential is genuine. Resetting the stored counter to 0 marks the
// baseline unknown: the verifier's guard passes the next assertion
// unconditionally and the counter re-seats from the authenticator's real
// value.
//
// Usage:
//   node scripts/reset_webauthn_counter.js --email <user email> [--device-id <id>] [--confirm RESET]
//
// Without --device-id every active webauthn device record for the user is
// reset (browser_key and revoked records are never touched). Non-interactive
// runs (SSM/CI) require --confirm RESET.

const readline = require('readline/promises');
const mongoose = require('mongoose');
const { loadLocalEnvFiles } = require('../config/runtimeConfig');

loadLocalEnvFiles();

require('../models/User');

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

const main = async () => {
    const args = parseArgs(process.argv.slice(2));
    const email = String(args.email || '').trim();
    const deviceId = String(args['device-id'] || '').trim();
    if (!email) throw new Error('--email is required');
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
    if (String(args.confirm || '').trim() !== 'RESET' && process.stdin.isTTY !== true) {
        throw new Error('Non-interactive use requires --confirm RESET');
    }

    await mongoose.connect(process.env.MONGO_URI);
    const user = await mongoose
        .model('User')
        .findOne({ email })
        .select('_id email trustedDevices');

    if (!user) throw new Error(`User not found: ${email}`);

    const targets = (user.trustedDevices || []).filter((device) => {
        if (device.method !== 'webauthn' || device.revoked) return false;
        if (deviceId) return String(device.deviceId || '') === deviceId;
        return true;
    });

    if (!targets.length) {
        console.log(`[reset-webauthn-counter] No active webauthn device records for ${email}. Nothing to do.`);
        await mongoose.disconnect();
        return;
    }

    for (const device of targets) {
        console.log(`[reset-webauthn-counter] ${device.deviceId}: counter ${Number(device.webauthnCounter || 0)} -> 0`);
        device.webauthnCounter = 0;
    }
    user.markModified('trustedDevices');
    await user.save();

    console.log(`[reset-webauthn-counter] Reset ${targets.length} device record(s) for ${email}. The next assertion re-seats the counter from the authenticator.`);
    await mongoose.disconnect();
};

main()
    .catch((error) => {
        console.error(`[reset-webauthn-counter] ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => {});
    });
