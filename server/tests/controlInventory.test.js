const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'security', 'check-control-inventory.mjs');
const inventoryPath = path.join(repoRoot, 'config', 'security', 'control-inventory.json');
const productionEnvPath = path.join(repoRoot, 'config', 'environments', 'production.example.env');

const runGate = (inventoryOverridePath) => {
  const args = [scriptPath];
  if (inventoryOverridePath) {
    args.push(`--inventory=${path.relative(repoRoot, inventoryOverridePath).split(path.sep).join('/')}`);
  }
  try {
    const stdout = execFileSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8' });
    return { status: 0, output: `${stdout}` };
  } catch (error) {
    return {
      status: Number(error.status ?? 1),
      output: `${error.stdout || ''}${error.stderr || ''}`,
    };
  }
};

const withTempInventory = (mutate) => {
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  mutate(inventory);
  const tempPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'aura-control-inventory-')),
    'control-inventory.json'
  );
  fs.writeFileSync(tempPath, JSON.stringify(inventory, null, 2));
  return tempPath;
};

describe('security control inventory gate', () => {
    test('the shipped inventory passes and every control is classified', () => {
        const result = runGate();
        expect(result.status).toBe(0);
        expect(result.output).toContain('[security:controls] PASS');

        const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
        expect(inventory.controls.length).toBeGreaterThan(0);
        for (const control of inventory.controls) {
            expect(typeof control.enforcedInProduction).toBe('boolean');
            // A control must never be silently unclassified.
            if (control.enforcedInProduction === true) {
                expect(control.staged).toBeNull();
                expect(typeof control.requiredValue).toBe('string');
                expect(control.requiredValue.length).toBeGreaterThan(0);
            } else {
                expect(control.staged).toBeTruthy();
                expect(String(control.staged.reason || '').trim().length).toBeGreaterThan(0);
                expect(Number.isFinite(Date.parse(control.staged.expires || ''))).toBe(true);
            }
        }
    });

    test('an expired staging justification fails the gate', () => {
        const tempPath = withTempInventory((inventory) => {
            const staged = inventory.controls.find((control) => control.enforcedInProduction === false);
            expect(staged).toBeTruthy();
            staged.staged.expires = '2020-01-01';
        });

        const result = runGate(tempPath);
        expect(result.status).toBe(1);
        expect(result.output).toContain('staging expired');
    });

    test('an enforced control missing from the production template fails the gate', () => {
        const tempPath = withTempInventory((inventory) => {
            const enforced = inventory.controls.find((control) => control.enforcedInProduction === true);
            expect(enforced).toBeTruthy();
            enforced.requiredValue = 'a-value-the-template-does-not-contain';
        });

        const result = runGate(tempPath);
        expect(result.status).toBe(1);
        expect(result.output).toContain('the production template sets it to');
    });

    test('a control that is neither enforced nor staged fails the gate', () => {
        const tempPath = withTempInventory((inventory) => {
            const control = inventory.controls.find((entry) => entry.enforcedInProduction === false);
            control.staged = null;
        });

        const result = runGate(tempPath);
        expect(result.status).toBe(1);
        expect(result.output).toContain('must be staged with a reason and an expiry');
    });

    test('a recorded code default that no longer matches the code fails the gate', () => {
        const tempPath = withTempInventory((inventory) => {
            const probed = inventory.controls.find((control) => control.codeDefaultProbe);
            expect(probed).toBeTruthy();
            probed.codeDefaultProbe.expected = 'a-value-the-code-never-returns';
        });

        const result = runGate(tempPath);
        expect(result.status).toBe(1);
        expect(result.output).toContain('code default drift');
    });

    test('the production template declares every enforced control', () => {
        const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
        const template = fs.readFileSync(productionEnvPath, 'utf8');
        for (const control of inventory.controls) {
            if (control.enforcedInProduction !== true) continue;
            expect(template).toMatch(new RegExp(`^${control.envVar}=`, 'm'));
        }
    });
});
