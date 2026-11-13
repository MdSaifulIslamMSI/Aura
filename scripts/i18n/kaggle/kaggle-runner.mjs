import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const repairEnginePath = path.join(repoRoot, 'scripts/i18n/icu-ast-repair-engine.mjs');
const workerScriptPath = path.join(scriptDir, 'run_ct2_repair.py');

const workRoot = path.join(repoRoot, 'artifacts/i18n/kaggle-work');
const datasetStageDir = path.join(workRoot, 'dataset');
const kernelStageDir = path.join(workRoot, 'kernel');
const outputDir = path.join(workRoot, 'output');
const tasksFile = path.join(datasetStageDir, 'repair_tasks.json');
const resultsFile = path.join(outputDir, 'repair_results.json');

function parseArgs(argv) {
    const positional = [];
    const flags = {};
    for (const arg of argv) {
        if (!arg.startsWith('--')) {
            positional.push(arg);
            continue;
        }
        const eqIdx = arg.indexOf('=');
        if (eqIdx === -1) {
            flags[arg.slice(2)] = true;
        } else {
            flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
        }
    }
    return { command: positional[0] || 'help', flags };
}

function resolveKaggleUsername(explicitOwner) {
    if (explicitOwner && typeof explicitOwner === 'string') {
        return explicitOwner.trim();
    }
    if (process.env.KAGGLE_USERNAME && process.env.KAGGLE_USERNAME.trim()) {
        return process.env.KAGGLE_USERNAME.trim();
    }
    const configDir = process.env.KAGGLE_CONFIG_DIR || path.join(os.homedir(), '.kaggle');
    const credsPath = path.join(configDir, 'kaggle.json');
    if (fs.existsSync(credsPath)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
            if (typeof parsed.username === 'string' && parsed.username.trim()) {
                return parsed.username.trim();
            }
        } catch {
            // Fall through to explicit configuration error without inspecting file contents
        }
    }
    throw new Error(
        'Missing Kaggle username. Pass --owner=<kaggle-username>, set KAGGLE_USERNAME, or configure ~/.kaggle/kaggle.json.'
    );
}

function ensureCleanDirs() {
    fs.mkdirSync(datasetStageDir, { recursive: true });
    fs.mkdirSync(kernelStageDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
}

function runKaggle(args, cwd = workRoot) {
    if (cwd === workRoot) {
        ensureCleanDirs();
    }
    return execFileSync('kaggle', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function verifyKaggleCli() {
    try {
        return runKaggle(['--version'], repoRoot);
    } catch (error) {
        throw new Error(`Kaggle CLI not available on PATH: ${error.message}`);
    }
}

function runExtract() {
    ensureCleanDirs();
    execFileSync(process.execPath, [repairEnginePath, '--extract', tasksFile], {
        cwd: repoRoot,
        stdio: 'inherit',
    });
}

function buildSlugs(owner, flags) {
    const tasksDataset = flags['tasks-dataset'] || `${owner}/aura-i18n-repair-tasks`;
    const modelDataset = flags['model-dataset'] || `${owner}/aura-nllb-ct2-offline`;
    const shards = Math.max(1, Number.parseInt(String(flags.shards || '1'), 10) || 1);
    const baseKernel = flags.kernel || `${owner}/aura-nllb-ct2-fast`;
    const kernelSlugs = shards === 1
        ? [baseKernel]
        : Array.from({ length: shards }, (_, idx) => `${owner}/aura-nllb-shard-${idx}`);
    return { tasksDataset, modelDataset, shards, baseKernel, kernelSlugs };
}

function buildDatasetSources(slugs, flags) {
    const sources = [slugs.tasksDataset];
    if (flags['include-model-dataset'] !== 'false' && slugs.modelDataset) {
        sources.push(slugs.modelDataset);
    }
    return sources;
}

function stageDatasetMetadata(slugs) {
    ensureCleanDirs();
    fs.writeFileSync(
        path.join(datasetStageDir, 'dataset-metadata.json'),
        `${JSON.stringify(
            {
                title: 'Aura i18n Repair Tasks',
                id: slugs.tasksDataset,
                licenses: [{ name: 'CC0-1.0' }],
            },
            null,
            2
        )}\n`,
        'utf8'
    );
}

function stageKernelDirs(slugs, flags) {
    const enableInternet = flags.internet !== 'false' && flags.internet !== false;
    const useGpu = flags.gpu === true || flags.gpu === 'true' || (slugs.shards === 1 && flags.cpu !== true);
    const datasetSources = buildDatasetSources(slugs, flags);
    const baseWorkerSource = fs.readFileSync(workerScriptPath, 'utf8');

    return slugs.kernelSlugs.map((kernelSlug, shardIndex) => {
        const relDir = slugs.shards === 1 ? 'kernel' : `kernel-shard-${shardIndex}`;
        const absDir = path.join(workRoot, relDir);
        fs.mkdirSync(absDir, { recursive: true });

        const shardEnvHeader = slugs.shards > 1
            ? `import os as _shard_os\n_shard_os.environ["AURA_SHARD_INDEX"] = "${shardIndex}"\n_shard_os.environ["AURA_SHARD_COUNT"] = "${slugs.shards}"\n`
            : '';
        fs.writeFileSync(
            path.join(absDir, 'run_ct2_repair.py'),
            `${shardEnvHeader}${baseWorkerSource}`,
            'utf8'
        );

        fs.writeFileSync(
            path.join(absDir, 'kernel-metadata.json'),
            `${JSON.stringify(
                {
                    id: kernelSlug,
                    title: slugs.shards === 1 ? 'Aura NLLB CT2 Fast' : `Aura NLLB Shard ${shardIndex}`,
                    code_file: 'run_ct2_repair.py',
                    language: 'python',
                    kernel_type: 'script',
                    is_private: true,
                    enable_gpu: useGpu,
                    enable_tpu: false,
                    enable_internet: enableInternet,
                    dataset_sources: datasetSources,
                    competition_sources: [],
                    kernel_sources: [],
                    model_sources: [],
                },
                null,
                2
            )}\n`,
            'utf8'
        );

        return { kernelSlug, relDir, useGpu };
    });
}

function pushDataset(slug) {
    let exists = false;
    try {
        runKaggle(['datasets', 'status', slug], workRoot);
        exists = true;
    } catch {
        exists = false;
    }

    if (exists) {
        console.log(`Updating private Kaggle dataset ${slug}...`);
        console.log(
            runKaggle(
                ['datasets', 'version', '-p', 'dataset', '-m', 'Refresh i18n AST repair tasks', '-r', 'skip'],
                workRoot
            )
        );
    } else {
        console.log(`Creating private Kaggle dataset ${slug}...`);
        console.log(runKaggle(['datasets', 'create', '-p', 'dataset', '-r', 'skip'], workRoot));
    }
}

function pushKernels(staged, accelerator) {
    for (const entry of staged) {
        const args = ['kernels', 'push', '-p', entry.relDir];
        if (entry.useGpu && accelerator) {
            args.push('--accelerator', accelerator);
        }
        console.log(runKaggle(args, workRoot));
    }
}

function getStatuses(slugs) {
    return slugs.kernelSlugs.map((kernelSlug) => ({
        kernelSlug,
        status: runKaggle(['kernels', 'status', kernelSlug], workRoot),
    }));
}

function pullOutputs(slugs) {
    ensureCleanDirs();
    if (slugs.shards === 1) {
        console.log(runKaggle(['kernels', 'output', slugs.kernelSlugs[0], '-p', 'output', '--force'], workRoot));
        if (!fs.existsSync(resultsFile)) {
            throw new Error(`Expected Kaggle output file not found at ${resultsFile}`);
        }
        return;
    }

    const merged = new Map();
    for (let idx = 0; idx < slugs.kernelSlugs.length; idx += 1) {
        const kernelSlug = slugs.kernelSlugs[idx];
        const shardRel = path.posix.join('output', `shard-${idx}`);
        const shardAbs = path.join(outputDir, `shard-${idx}`);
        fs.mkdirSync(shardAbs, { recursive: true });
        console.log(runKaggle(['kernels', 'output', kernelSlug, '-p', shardRel, '--force'], workRoot));
        const shardJson = path.join(shardAbs, 'repair_results.json');
        if (!fs.existsSync(shardJson)) {
            throw new Error(`Missing shard output at ${shardJson}`);
        }
        const rows = JSON.parse(fs.readFileSync(shardJson, 'utf8'));
        for (const row of rows) {
            if (row && row.id && typeof row.translatedText === 'string' && row.translatedText.trim()) {
                merged.set(row.id, row.translatedText);
            }
        }
    }

    const mergedRows = Array.from(merged.entries()).map(([id, translatedText]) => ({
        id,
        translatedText,
    }));
    fs.writeFileSync(resultsFile, JSON.stringify(mergedRows), 'utf8');
    console.log(`Merged ${mergedRows.length} unique repaired records -> ${resultsFile}`);
}

function applyOutputs() {
    if (!fs.existsSync(resultsFile)) {
        throw new Error(`No Kaggle results found at ${resultsFile}. Run pull first.`);
    }
    execFileSync(process.execPath, [repairEnginePath, '--apply', resultsFile], {
        cwd: repoRoot,
        stdio: 'inherit',
    });
    execFileSync(process.execPath, [repairEnginePath, '--inspect'], {
        cwd: repoRoot,
        stdio: 'inherit',
    });
}

async function waitForCompletion(slugs, pollSeconds = 20, maxWaitSeconds = 1800) {
    const deadline = Date.now() + maxWaitSeconds * 1000;
    while (Date.now() < deadline) {
        const statuses = getStatuses(slugs);
        statuses.forEach(({ status }) => console.log(`[Kaggle] ${status}`));
        const failed = statuses.find(({ status }) => /ERROR|CANCEL/.test(status));
        if (failed) {
            throw new Error(`Kaggle kernel terminated unexpectedly: ${failed.status}`);
        }
        if (statuses.every(({ status }) => /COMPLETE/.test(status))) {
            return statuses;
        }
        await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
    }
    throw new Error(`Timed out after ${maxWaitSeconds}s waiting for Kaggle kernels`);
}

const { command, flags } = parseArgs(process.argv.slice(2));

if (command === 'help' || flags.help) {
    console.log(`Usage: node scripts/i18n/kaggle/kaggle-runner.mjs <command> [options]

Commands:
  doctor   Verify Kaggle CLI and configured username without printing credentials
  extract  Extract AST-masked NLLB segments into artifacts/i18n/kaggle-work/dataset/
  push     Stage metadata, upload private dataset, and launch Kaggle worker kernel(s)
  status   Check remote Kaggle kernel worker status
  pull     Download remote Kaggle kernel outputs (and merge shards) into output/repair_results.json
  apply    Apply downloaded repair_results.json through icu-ast-repair-engine.mjs
  run      Full cloud end-to-end pipeline: extract -> push -> wait -> pull -> apply

Options:
  --owner=<user>              Override Kaggle username
  --shards=<n>                Launch N parallel sharded CPU/GPU Kaggle workers (default: 1)
  --cpu                       Force CPU worker metadata (no GPU accelerator flag)
  --gpu                       Force GPU worker metadata even when sharded
  --skip-dataset              Reuse already-uploaded Kaggle datasets when pushing workers
  --accelerator=<gpu>         Kaggle GPU accelerator (default: NvidiaTeslaT4)
  --tasks-dataset=<slug>      Target tasks dataset slug
  --model-dataset=<slug>      Pre-staged CT2 offline model dataset slug
  --kernel=<slug>             Target Kaggle kernel slug (when shards=1)
  --internet=true|false       Enable Kaggle outbound internet (default: true)`);
    process.exit(0);
}

if (command === 'extract') {
    runExtract();
    process.exit(0);
}

const version = verifyKaggleCli();
const owner = resolveKaggleUsername(flags.owner);
const slugs = buildSlugs(owner, flags);
const accelerator = flags.accelerator || 'NvidiaTeslaT4';

switch (command) {
    case 'doctor':
        console.log(`Kaggle CLI: ${version}`);
        console.log(`Kaggle owner: ${owner}`);
        console.log(`Tasks dataset: ${slugs.tasksDataset}`);
        console.log(`Model dataset: ${slugs.modelDataset}`);
        console.log(`Workers (${slugs.shards}): ${slugs.kernelSlugs.join(', ')}`);
        break;
    case 'push': {
        if (!flags['skip-dataset']) {
            if (!fs.existsSync(tasksFile)) {
                runExtract();
            }
            stageDatasetMetadata(slugs);
            pushDataset(slugs.tasksDataset);
        }
        const staged = stageKernelDirs(slugs, flags);
        pushKernels(staged, accelerator);
        break;
    }
    case 'status':
        getStatuses(slugs).forEach(({ status }) => console.log(status));
        break;
    case 'pull':
        pullOutputs(slugs);
        break;
    case 'apply':
        applyOutputs();
        break;
    case 'run': {
        if (!flags['skip-dataset']) {
            runExtract();
            stageDatasetMetadata(slugs);
            pushDataset(slugs.tasksDataset);
        }
        const staged = stageKernelDirs(slugs, flags);
        pushKernels(staged, accelerator);
        await waitForCompletion(slugs);
        pullOutputs(slugs);
        applyOutputs();
        break;
    }
    default:
        throw new Error(`Unknown command "${command}". Run with --help for usage.`);
}
