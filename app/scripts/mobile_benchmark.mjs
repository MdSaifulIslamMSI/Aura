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
  const result = {
    name: flow.name,
    success: false,
    stepCount: Array.isArray(flow.steps) ? flow.steps.length : 0,
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

const runLighthouseAudit = async ({ lighthouse, auditUrl, chromePort, viewport }) => {
  const runnerResult = await lighthouse(auditUrl, {
    port: chromePort,
    output: 'json',
    logLevel: 'error',
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
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
  return {
    url: auditUrl,
    performance: Number(((categories.performance?.score || 0) * 100).toFixed(2)),
    accessibility: Number(((categories.accessibility?.score || 0) * 100).toFixed(2)),
    bestPractices: Number(((categories['best-practices']?.score || 0) * 100).toFixed(2)),
    seo: Number(((categories.seo?.score || 0) * 100).toFixed(2)),
  };
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

  const benchmarkReport = {
    configPath,
    generatedAt: new Date().toISOString(),
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
          const requiresEnv = Array.isArray(flow.requiresEnv) ? flow.requiresEnv : [];
          const missingEnv = requiresEnv.filter((key) => !process.env[key]);
          if (missingEnv.length > 0) {
            flowResults.push({
              name: flow.name,
              success: false,
              skipped: true,
              reason: `Missing env: ${missingEnv.join(', ')}`,
              stepCount: Array.isArray(flow.steps) ? flow.steps.length : 0,
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
        });

        benchmarkReport.targets.push({
          label: target.label,
          viewport: viewport.name,
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
};

run().catch((error) => {
  console.error(`Mobile benchmark failed: ${error.message}`);
  process.exitCode = 1;
});
