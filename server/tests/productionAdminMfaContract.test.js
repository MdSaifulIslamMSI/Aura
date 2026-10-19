const fs = require('fs');
const path = require('path');

const { validateAuthEnvironment } = require('../config/authEnvironment');

const repoRoot = path.resolve(__dirname, '..', '..');
const readRepoFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

/**
 * The production environment contract refuses to boot unless admin MFA is
 * required and the brute-force account lockout is armed. That refusal is only
 * safe if the deployment actually provides those two variables - a contract
 * that demands a setting nothing supplies turns every deploy into a
 * fail-closed outage.
 *
 * These assertions link the two halves: the runtime contract and the
 * deployment that has to satisfy it.
 */
describe('production admin-MFA and lockout deployment contract', () => {
    const baseEnvKeys = () => {
        const text = readRepoFile('infra/aws/bootstrap-instance-user-data.sh');
        const block = text.match(/cat > \/opt\/aura\/shared\/base\.env <<'EOF'\r?\n([\s\S]*?)\r?\nEOF/);
        expect(block).toBeTruthy();
        const values = new Map();
        for (const line of block[1].split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const separator = trimmed.indexOf('=');
            if (separator <= 0) continue;
            values.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
        }
        return values;
    };

    test('the instance base.env template provides both required settings', () => {
        const values = baseEnvKeys();
        expect(values.get('MFA_REQUIRED_FOR_ADMINS')).toBe('true');
        expect(values.get('AUTH_LOCKOUT_MODE')).toBe('enforce');
    });

    test('both AWS compose services provide both required settings', () => {
        for (const relativePath of [
            'infra/aws/docker-compose.ec2.yml',
            'infra/aws/docker-compose.slot.yml',
        ]) {
            const text = readRepoFile(relativePath);
            expect(text.includes('MFA_REQUIRED_FOR_ADMINS: "true"')).toBe(true);
            expect(text.includes('AUTH_LOCKOUT_MODE: "enforce"')).toBe(true);
        }
    });

    test('the deploy and the rollback both persist both required settings', () => {
        const deploy = readRepoFile('infra/aws/deploy-release.sh');
        const rollback = readRepoFile('infra/aws/rollback-backend.sh');
        for (const text of [deploy, rollback]) {
            expect(text).toContain('upsert_env_value "${staged_base_env}" "MFA_REQUIRED_FOR_ADMINS" "true"');
            expect(text).toContain('upsert_env_value "${staged_base_env}" "AUTH_LOCKOUT_MODE" "enforce"');
        }
    });

    test('both settings are runtime configuration, not Parameter Store secrets', () => {
        // MFA_ENABLED and MFA_PASSKEY_ENABLED are supplied by the instance
        // base.env and the compose files, not by Parameter Store, and the
        // SSM contract audit treats every listed key as a required secret.
        // Listing a plain setting there would demand a parameter that does not
        // exist and turn CI red, so these two follow the MFA_ENABLED pattern.
        const { DEFAULT_AWS_PARAMETER_KEYS } = require('../config/ssm-parameter-keys.cjs');
        expect(DEFAULT_AWS_PARAMETER_KEYS).not.toContain('MFA_REQUIRED_FOR_ADMINS');
        expect(DEFAULT_AWS_PARAMETER_KEYS).not.toContain('AUTH_LOCKOUT_MODE');
        expect(DEFAULT_AWS_PARAMETER_KEYS).not.toContain('MFA_ENABLED');
    });

    test('the production environment example provides both required settings', () => {
        const text = readRepoFile('config/environments/production.example.env');
        expect(text).toMatch(/^MFA_REQUIRED_FOR_ADMINS=true$/m);
        expect(text).toMatch(/^AUTH_LOCKOUT_MODE=enforce$/m);
    });

    test('the runtime contract actually refuses to boot without them', () => {
        // The refusal the deployment has to satisfy.
        const base = {
            NODE_ENV: 'production',
            AUTH_PROVIDER: 'legacy',
            MFA_ENABLED: 'true',
            MFA_PASSKEY_ENABLED: 'true',
            MFA_TOTP_ENABLED: 'true',
            AUTH_REQUIRE_MFA_FOR_ADMIN: 'true',
            MFA_REQUIRED_FOR_ADMINS: 'true',
            AUTH_LOCKOUT_MODE: 'enforce',
        };

        const complete = validateAuthEnvironment({ env: base, runtimeEnv: 'production' });
        expect(complete.failures.join('\n')).not.toMatch(/MFA_REQUIRED_FOR_ADMINS/);
        expect(complete.failures.join('\n')).not.toMatch(/AUTH_LOCKOUT_MODE/);

        const withoutAdminMfa = validateAuthEnvironment({
            env: { ...base, MFA_REQUIRED_FOR_ADMINS: 'false' },
            runtimeEnv: 'production',
        });
        expect(withoutAdminMfa.failures.join('\n')).toMatch(/MFA_REQUIRED_FOR_ADMINS must be true/);

        const withoutLockout = validateAuthEnvironment({
            env: { ...base, AUTH_LOCKOUT_MODE: 'off' },
            runtimeEnv: 'production',
        });
        expect(withoutLockout.failures.join('\n')).toMatch(/AUTH_LOCKOUT_MODE must be monitor or enforce/);

        const unsetLockout = validateAuthEnvironment({
            env: { ...base, AUTH_LOCKOUT_MODE: undefined },
            runtimeEnv: 'production',
        });
        expect(unsetLockout.failures.join('\n')).toMatch(/AUTH_LOCKOUT_MODE must be monitor or enforce/);
    });
});
