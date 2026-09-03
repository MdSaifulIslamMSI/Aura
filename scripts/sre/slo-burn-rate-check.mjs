#!/usr/bin/env node
// Pure, dependency-free SLO burn-rate calculator. No network calls.
// Burn rate = (errors / total) / (1 - sloTarget).
// Thresholds assume a 30-day SLO window (Google SRE multiwindow style):
//   fast-burn >= 14.4x -> page (exit 2), slow-burn >= 6x -> ticket (exit 1).
import process from 'node:process';

const PAGE_THRESHOLD = 14.4;
const TICKET_THRESHOLD = 6;

const usage = () => [
  'Usage:',
  '  node scripts/sre/slo-burn-rate-check.mjs --window <label> --errors <n> --total <m> --slo-target <0..1>',
  '  node scripts/sre/slo-burn-rate-check.mjs --self-test',
  '',
  'Prints a JSON verdict {window, sloTarget, errors, total, errorRatio, budgetRatio, burnRate, verdict}.',
  'Exit codes: 0 ok (burn < 6), 1 ticket (6 <= burn < 14.4), 2 page (burn >= 14.4).',
].join('\n');

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--self-test') {
      args.selfTest = true;
      continue;
    }
    if (flag.startsWith('--')) {
      args[flag.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
};

const verdictFor = (burnRate) => {
  if (burnRate >= PAGE_THRESHOLD) return { verdict: 'page', exitCode: 2 };
  if (burnRate >= TICKET_THRESHOLD) return { verdict: 'ticket', exitCode: 1 };
  return { verdict: 'ok', exitCode: 0 };
};

const check = ({ window, errors, total, sloTarget }) => {
  const errorCount = Number(errors);
  const totalCount = Number(total);
  const target = Number(sloTarget);
  if (!window) throw new Error('--window is required.');
  if (!Number.isFinite(errorCount) || errorCount < 0) throw new Error('--errors must be a number >= 0.');
  if (!Number.isFinite(totalCount) || totalCount <= 0) throw new Error('--total must be a number > 0.');
  if (errorCount > totalCount) throw new Error('--errors must not exceed --total.');
  if (!Number.isFinite(target) || target <= 0 || target >= 1) throw new Error('--slo-target must be between 0 and 1 (exclusive).');
  const errorRatio = errorCount / totalCount;
  const budgetRatio = 1 - target;
  const burnRate = errorRatio / budgetRatio;
  const { verdict, exitCode } = verdictFor(burnRate);
  return { window, sloTarget: target, errors: errorCount, total: totalCount, errorRatio, budgetRatio, burnRate, verdict, exitCode };
};

const runSelfTest = () => {
  // Deterministic cases against a 99.9% SLO (budget ratio 0.001).
  const cases = [
    { name: 'healthy', input: { window: '1h', errors: 1, total: 10000, sloTarget: 0.999 }, expected: 'ok' },
    { name: 'slow-burn', input: { window: '6h', errors: 80, total: 10000, sloTarget: 0.999 }, expected: 'ticket' },
    { name: 'fast-burn', input: { window: '1h', errors: 200, total: 10000, sloTarget: 0.999 }, expected: 'page' },
  ];
  const failures = [];
  for (const { name, input, expected } of cases) {
    const result = check(input);
    console.log(JSON.stringify({ selfTest: name, ...result, expected }));
    if (result.verdict !== expected) failures.push(`${name}: expected ${expected}, got ${result.verdict}`);
  }
  if (failures.length > 0) {
    console.error('FAIL: slo burn-rate self-test');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log('PASS: slo burn-rate self-test (3/3)');
};

const args = parseArgs(process.argv.slice(2));

if (args.selfTest) {
  runSelfTest();
} else {
  try {
    const result = check({ window: args.window, errors: args.errors, total: args.total, sloTarget: args['slo-target'] });
    const { exitCode, ...verdict } = result;
    console.log(JSON.stringify(verdict));
    process.exit(exitCode);
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    console.error(usage());
    process.exit(1);
  }
}
