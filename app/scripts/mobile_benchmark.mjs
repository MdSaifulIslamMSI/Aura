import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const parseArgs = () => process.argv.slice(2).reduce((acc, arg) => {
  if (!arg.startsWith('--')) return acc;
  const [rawKey, ...rawValue] = arg.slice(2).split('=');
  acc[rawKey] = rawValue.length > 0 ? rawValue.join('=') : 'true';
  return acc;
}, {});

const args = parseArgs();

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const defaultConfigPath = path.resolve(rootDir, 'docs', 'mobile-benchmark.targets.json');
const defaultReportPath = path.resolve(rootDir, 'docs', 'reports', 'mobile-benchmark.latest.json');

const configPath = path.resolve(args.config || process.env.MOBILE_BENCHMARK_CONFIG || defaultConfigPath);
const reportPath = path.resolve(args.report || process.env.MOBILE_BENCHMARK_REPORT || defaultReportPath);

// Interaction flows need a live backend and a populated catalog. The nightly
// serves a static `vite preview` with no API, so every flow that reaches a
// product listing renders "Showing 0 of 0 items" and cannot pass. Lighthouse
// scoring does not need the backend, so the nightly runs scoring-only and
// delegates interaction coverage to Playwright E2E
// (app/e2e, which boots `scripts/start_e2e_server.mjs` plus a Pixel 7 project).
const skipFlows = args.flows === 'off' || String(process.env.MOBILE_BENCHMARK_FLOWS || '') === 'off';
const FLOW_SKIP_REASON = 'Flows disabled for this run (scoring-only mode). Interaction coverage lives in app/e2e.';

const viewportProfiles = [
  { name: '360x800', width: 360, height: 800 },
  { name: '390x844', width: 390, height: 844 },
];

const ensureParentDir = async (filePath) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
};

const loadConfig = async () => {
  const raw = await fs.readFile(configPath, 'utf8');
  return JSON.parse(raw);
};

const requireModule = async (specifier, installHint) => {
  try {
    return await import(specifier);
  } catch (error) {
    throw new Error(`${specifier} is required for mobile benchmarking. Install it first (${installHint}). Original error: ${error.message}`);
  }
};

const performStep = async (page, step) => {
  switch (step.type) {
    case 'goto':
      await page.goto(step.url, { waitUntil: step.waitUntil || 'domcontentloaded' });
      return;
    case 'waitForSelector':
      await page.waitForSelector(step.selector, { timeout: step.timeout || 15000 });
      return;
    case 'fill':
      await page.locator(step.selector).first().fill(step.value);
      return;
    case 'click':
      await page.locator(step.selector).first().click();
      return;
    case 'press':
      await page.locator(step.selector).first().press(step.key);
      return;
    case 'waitForUrl':
      await page.waitForURL((url) => String(url).includes(step.urlIncludes), {
        timeout: step.timeout || 15000,
      });
      return;
    default:
      throw new Error(`Unsupported benchmark step type: ${step.type}`);
  }
};

const runFlow = async ({ page, flow }) => {
  const startedAt = Date.now();
  const plannedSteps = Array.isArray(flow.steps) ? flow.steps.length : 0;
  const result = {
    name: flow.name,
    success: false,
    // `stepCount` counts steps that actually completed, not steps declared in
    // config. The previous implementation seeded this from flow.steps.length,
    // which made every flow look like it had met its step budget even when it
    // timed out on step one.
    stepCount: 0,
    plannedSteps,
    durationMs: 0,
    finalUrl: '',
    error: '',
    note: flow.note || '',
  };

  try {
    if (flow.startUrl) {
      await page.goto(flow.startUrl, { waitUntil: 'domcontentloaded' });
    }

    for (const step of flow.steps || []) {
      await performStep(page, step);
      result.stepCount += 1;
    }

    result.success = true;
    result.finalUrl = page.url();
  } catch (error) {
    result.error = error.message;
    result.finalUrl = page.url();
  } finally {
    result.durationMs = Date.now() - startedAt;
  }

  return result;
};

const AUDIT_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

// Lighthouse's mobile emulation defaults are not guaranteed stable across
// lighthouse upgrades, and `throttlingMethod: 'simulate'` is what keeps scores
// comparable between runs at all - 'devtools' re-throttles against real host
// speed and drifts with runner load. Pin both explicitly so a number from this
// gate means the same thing next month.
const AUDIT_THROTTLING = {
  rttMs: 150,
  throughputKbps: 1638.4,
  cpuSlowdownMultiplier: 4,
  requestLatencyMs: 562.5,
  downloadThroughputKbps: 1474.56,
  uploadThroughputKbps: 675,
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

const round2 = (value) => Number(Number(value).toFixed(2));

// One Lighthouse pass on a shared CI runner is not a measurement: the same
// home page has been observed at 26, 27, 43, 53 and 56. Take repeated samples
// and gate on the median, which is far more stable than any single pass, and
// publish the spread so a noisy environment is visible instead of silent.
const runLighthouseAudit = async ({ lighthouse, auditUrl, chromePort, viewport, repeats }) => {
  const samples = [];
  const errors = [];

  for (let attempt = 0; attempt < repeats; attempt += 1) {
    try {
      const runnerResult = await lighthouse(auditUrl, {
        port: chromePort,
        output: 'json',
        logLevel: 'error',
        onlyCategories: AUDIT_CATEGORIES,
        throttlingMethod: 'simulate',
        throttling: AUDIT_THROTTLING,
        screenEmulation: {
          mobile: true,
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 2,
          disabled: false,
        },
        emulatedUserAgent: 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Mobile Safari/537.36',
      });

      const categories = runnerResult?.lhr?.categories || {};
      const scoreOf = (name) => {
        const score = categories[name]?.score;
        return typeof score === 'number' ? round2(score * 100) : null;
      };

      const sample = {
        performance: scoreOf('performance'),
        accessibility: scoreOf('accessibility'),
        bestPractices: scoreOf('best-practices'),
        seo: scoreOf('seo'),
      };

      if (sample.performance === null) {
        throw new Error('Lighthouse returned no performance score');
      }

      samples.push(sample);
    } catch (error) {
      errors.push(error.message);
    }
  }

  const summarise = (key) => {
    const values = samples.map((sample) => sample[key]).filter((value) => typeof value === 'number');
    if (values.length === 0) return null;
    const mid = median(values);
    return {
      median: round2(mid),
      min: round2(Math.min(...values)),
      max: round2(Math.max(...values)),
      spread: round2(Math.max(...values) - Math.min(...values)),
      samples: values.map(round2),
    };
  };

  const audit = { url: auditUrl, repeats, successfulSamples: samples.length };
  if (samples.length === 0) {
    // Previously a failed audit collapsed to `score || 0`, so a competitor
    // target that could not be reached reported a clean 0 and looked measured.
    audit.error = errors[0] || 'all Lighthouse attempts failed';
    for (const key of ['performance', 'accessibility', 'bestPractices', 'seo']) {
      audit[key] = null;
      audit[key + 'Stats'] = null;
    }
    return audit;
  }

  for (const [key, stat] of [
    ['performance', summarise('performance')],
    ['accessibility', summarise('accessibility')],
    ['bestPractices', summarise('bestPractices')],
    ['seo', summarise('seo')],
  ]) {
    audit[key] = stat ? stat.median : null;
    audit[`${key}Stats`] = stat;
  }
  if (errors.length > 0) {
    audit.partialErrors = errors;
  }

  return audit;
};

const run = async () => {
  const config = await loadConfig();
  const targets = Array.isArray(config.targets) ? config.targets : [];
  if (targets.length === 0) {
    throw new Error(`No benchmark targets found in ${configPath}`);
  }

  const { chromium, devices } = await requireModule('playwright', 'npm install -D playwright');
  const lighthouseModule = await requireModule('lighthouse', 'npm install -D lighthouse');
  const lighthouse = lighthouseModule.default || lighthouseModule;

  const settings = config.settings || {};
  const auditRepeats = Number(settings.auditRepeats) > 0 ? Number(settings.auditRepeats) : 3;
  // Budgets are asserted against exactly one viewport. The 360x800 and 390x844
  // profiles score differently on an unchanged page, so a single shared budget
  // across both compared numbers that were never comparable. Other viewports
  // are still measured and reported, but only the gating one can fail the run.
  const requestedGating = String(settings.gatingViewport || viewportProfiles[0].name);
  const gatingViewport = viewportProfiles.some((profile) => profile.name === requestedGating)
    ? requestedGating
    : viewportProfiles[0].name;

  const benchmarkReport = {
    configPath,
    generatedAt: new Date().toISOString(),
    // Recorded so a surprising number can be traced to the code and host that
    // produced it rather than being compared across unrelated changes.
    environment: {
      commit: process.env.GITHUB_SHA || null,
      runId: process.env.GITHUB_RUN_ID || null,
      runner: process.env.RUNNER_NAME || process.env.RUNNER_OS || null,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
    },
    settings: { auditRepeats, gatingViewport },
    viewports: viewportProfiles,
    targets: [],
  };

  for (const viewport of viewportProfiles) {
    const chromePort = 9222 + Math.floor(Math.random() * 500);
    const browser = await chromium.launch({
      headless: true,
      args: [`--remote-debugging-port=${chromePort}`],
    });

    try {
      for (const target of targets) {
        const deviceProfile = devices['Pixel 5'] || null;
        const context = await browser.newContext({
          ...(deviceProfile || {}),
          viewport: { width: viewport.width, height: viewport.height },
        });
        const page = await context.newPage();
        const flowResults = [];

        for (const flow of target.flows || []) {
          const plannedSteps = Array.isArray(flow.steps) ? flow.steps.length : 0;

          if (skipFlows) {
            flowResults.push({
              name: flow.name,
              success: false,
              skipped: true,
              reason: FLOW_SKIP_REASON,
              stepCount: 0,
              plannedSteps,
              durationMs: 0,
              finalUrl: '',
            });
            continue;
          }

          const requiresEnv = Array.isArray(flow.requiresEnv) ? flow.requiresEnv : [];
          const missingEnv = requiresEnv.filter((key) => !process.env[key]);
          if (missingEnv.length > 0) {
            flowResults.push({
              name: flow.name,
              success: false,
              skipped: true,
              reason: `Missing env: ${missingEnv.join(', ')}`,
              // A skipped flow completed nothing.
              stepCount: 0,
              plannedSteps,
              durationMs: 0,
              finalUrl: '',
            });
            continue;
          }

          flowResults.push(await runFlow({ page, flow }));
        }

        const audit = await runLighthouseAudit({
          lighthouse,
          auditUrl: target.auditUrl || target.baseUrl,
          chromePort,
          viewport,
          // Repeated sampling exists to stabilise a budget assertion. A target
          // with no budget is comparison-only, and repeating it would multiply
          // live page loads against third-party sites (flipkart.com, amazon.in)
          // for no gain.
          repeats: target.budget ? auditRepeats : 1,
        });

        benchmarkReport.targets.push({
          label: target.label,
          viewport: viewport.name,
          gating: viewport.name === gatingViewport,
          baseUrl: target.baseUrl,
          audit,
          flows: flowResults,
          incumbentBaseline: target.incumbentBaseline || null,
        });

        await context.close();
      }
    } finally {
      await browser.close();
    }
  }

  await ensureParentDir(reportPath);
  await fs.writeFile(reportPath, JSON.stringify(benchmarkReport, null, 2));
  console.log(JSON.stringify({ ...benchmarkReport, reportPath }, null, 2));

  if (args.assert) {
    assertBudgets(config, benchmarkReport);
  }
};

const assertBudgets = (config, benchmarkReport) => {
  const failures = [];

  for (const entry of benchmarkReport.targets) {
    const target = (config.targets || []).find((candidate) => candidate.label === entry.label);
    const budget = target?.budget;
    if (!budget) continue;

    // Only the pinned gating viewport can fail the run. Everything else is
    // still measured and reported so drift stays visible.
    if (!entry.gating) continue;

    // An audit that could not be produced is a failure, not a zero. Treating a
    // dead audit as `score || 0` is how an unreachable target looked measured.
    if (entry.audit?.error) {
      failures.push(`${entry.label} [${entry.viewport}] Lighthouse audit failed: ${entry.audit.error}`);
    }

    const scoreChecks = [
      ['performance', budget.minPerformanceScore],
      ['accessibility', budget.minAccessibilityScore],
      ['best-practices', budget.minBestPracticesScore],
    ];
    for (const [category, minScore] of scoreChecks) {
      if (!minScore) continue;
      const score = entry.audit?.[category];
      if (score === null || score === undefined) continue; // already reported above
      if (score < minScore) {
        const stats = entry.audit?.[`${category === 'best-practices' ? 'bestPractices' : category}Stats`];
        const detail = stats
          ? ` (median of ${stats.samples.length}: ${stats.samples.join(', ')}, spread ${stats.spread})`
          : '';
        failures.push(`${entry.label} [${entry.viewport}] Lighthouse ${category} score ${score} < budget ${minScore}${detail}`);
      }
    }

    // A flow that actually ran and then failed is a gate failure in its own
    // right. Previously only the step budget was inspected, so a flow that
    // timed out on its very first step still counted as "passed" the budget
    // check. This is what let the nightly stay quiet while every flow failed.
    for (const flow of entry.flows || []) {
      if (flow.skipped || flow.success) continue;
      const detail = String(flow.error || flow.reason || 'unknown error').split('\n')[0].trim();
      failures.push(
        `${entry.label} [${entry.viewport}] flow ${flow.name} failed after `
        + `${flow.stepCount ?? 0}/${flow.plannedSteps ?? 0} steps: ${detail}`,
      );
    }

    for (const [flowName, maxSteps] of Object.entries(budget.maxFlowStepCount || {})) {
      const flow = (entry.flows || []).find((candidate) => candidate.name === flowName);
      if (!flow || flow.skipped) continue;
      const steps = Number(flow.stepCount ?? 0);
      if (steps > maxSteps) {
        failures.push(`${entry.label} [${entry.viewport}] flow ${flowName} used ${steps} steps > budget ${maxSteps}`);
      }
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`::error::Mobile benchmark budget violated: ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('Mobile benchmark budget assertions passed.');
};

run().catch((error) => {
  console.error(`Mobile benchmark failed: ${error.message}`);
  process.exitCode = 1;
});
