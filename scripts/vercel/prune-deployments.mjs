#!/usr/bin/env node
// Lists retained Vercel deployments and optionally prunes previews.
//
// The team sits on the free tier, where Deployment Storage is a hard 10 GB
// cap shared by every project, and Vercel never expires a deployment on its
// own. Without pruning, every PR preview accumulates until the account locks.
//
// Usage:
//   node scripts/vercel/prune-deployments.mjs --dry-run
//   node scripts/vercel/prune-deployments.mjs --apply --keep=5 --confirm=prune
//
// Safety properties, in order:
//   1. Dry run unless --apply is passed explicitly.
//   2. --apply without --confirm=prune refuses to delete anything.
//   3. Production deployments are never candidates.
//   4. Anything holding a production alias is never deleted.
//   5. Only ids matching dpl_* are sent to the API.

import process from 'node:process';

const VERCEL_API = 'https://api.vercel.com';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback = '') => {
    const match = args.find((arg) => arg.startsWith(`--${name}=`));
    return match ? match.slice(name.length + 3) : fallback;
};

const dryRun = !flag('apply');
const confirm = option('confirm');
const keepCount = Number(option('keep', '5'));
const token = (process.env.VERCEL_TOKEN || '').trim();
const teamId = option('team', process.env.VERCEL_SCOPE || '').trim();

const PROJECTS = [
    { name: option('storefront-project', 'app') },
    { name: option('gateway-project', 'aura-gateway') },
];

const ALIASES = [
    option('storefront-alias', 'aurapilot.vercel.app'),
    option('gateway-alias', 'aura-gateway.vercel.app'),
];

const log = (message) => console.log(message);

const fail = (message) => {
    console.error(message);
    process.exit(1);
};

if (!token) {
    fail('VERCEL_TOKEN is required. Export it from the GitHub secret; never commit it.');
}

if (!Number.isInteger(keepCount) || keepCount < 0) {
    fail(`--keep must be a non-negative integer, received "${option('keep')}".`);
}

if (!dryRun && confirm !== 'prune') {
    fail('Refusing to delete without --confirm=prune. Re-run with that flag once the dry run looks right.');
}

const request = async (endpoint, init = {}) => {
    const response = await fetch(`${VERCEL_API}${endpoint}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(init.headers || {}),
        },
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Vercel API ${init.method || 'GET'} ${endpoint} failed: ${response.status} ${body.slice(0, 200)}`);
    }

    return response.json();
};

const listTeamProjects = async () => {
    if (!teamId) return [];
    const teams = await request(`/v2/teams/${encodeURIComponent(teamId)}`);
    const scope = teams?.team?.id || teamId;
    const owned = await request(`/v9/projects?limit=100&teamId=${encodeURIComponent(scope)}`);
    return (owned.projects || []).map((project) => project.name);
};

const listDeployments = async (projectId) => {
    const deployments = [];
    // Paging keeps this correct on accounts with a long deployment history,
    // which is exactly the situation that motivates the prune.
    for (let skip = 0; skip < 1000; skip += 100) {
        const page = await request(`/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=100&skip=${skip}`);
        const items = page.deployments || [];
        deployments.push(...items);
        if (items.length < 100) break;
    }
    return deployments;
};

const resolveProjectId = async (projectName) => {
    const result = await request(`/v9/projects/${encodeURIComponent(projectName)}`);
    return result.id;
};

const resolveProtectedIds = async () => {
    const protectedIds = new Set();

    for (const alias of ALIASES) {
        if (!alias) continue;
        try {
            const aliasState = await request(`/v4/aliases/${alias}`);
            const id = aliasState?.deploymentId || aliasState?.deployment?.id;
            if (id) protectedIds.add(id);
        } catch {
            // A missing or protected alias is not a reason to skip the prune;
            // it only means this alias is not currently resolvable.
        }
    }

    return protectedIds;
};

const isProduction = (deployment) => (
    deployment.target === 'production' || deployment.meta?.githubCommitRef === 'main'
);

const describe = (deployment) => {
    const created = deployment.createdAt ? new Date(deployment.createdAt).toISOString() : 'unknown';
    return `  ${deployment.uid}  ${deployment.target || 'preview'}  ${created}  ${deployment.name || deployment.url || ''}`;
};

const run = async () => {
    const teamProjects = await listTeamProjects().catch(() => []);
    if (teamProjects.length > 0) {
        log('Projects visible in this team:');
        teamProjects.forEach((name) => log(`  - ${name}`));
        const known = new Set(PROJECTS.map((project) => project.name));
        const unhandled = teamProjects.filter((name) => !known.has(name));
        if (unhandled.length > 0) {
            log('');
            log(`Note: ${unhandled.length} project(s) are not covered by the default prune list.`);
            log('They still count against the team-wide cap. Consider deleting them in the dashboard:');
            unhandled.forEach((name) => log(`  - ${name}`));
        }
        log('');
    }

    const protectedIds = await resolveProtectedIds();
    if (protectedIds.size > 0) {
        log(`Protected (alias-holding) deployments: ${[...protectedIds].join(', ')}`);
        log('');
    }

    let totalDeployments = 0;
    let totalDeletable = 0;
    const failures = [];

    for (const project of PROJECTS) {
        const projectId = await resolveProjectId(project.name);
        const deployments = await listDeployments(projectId);
        const previews = deployments
            .filter((deployment) => !isProduction(deployment))
            .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));

        const keep = previews.slice(0, keepCount);
        const keepIds = new Set(keep.map((deployment) => deployment.uid));
        const deletable = previews.filter((deployment) => (
            !keepIds.has(deployment.uid)
            && /^dpl_/.test(deployment.uid || '')
            && !protectedIds.has(deployment.uid)
        ));

        totalDeployments += deployments.length;
        totalDeletable += deletable.length;

        log(`Project ${project.name}: ${deployments.length} deployment(s), `
            + `${previews.length} preview(s), keeping newest ${keep.length}, `
            + `${deletable.length} deletable.`);

        if (deletable.length > 0) {
            log(deletable.slice(0, 10).map(describe).join('\n'));
            if (deletable.length > 10) log(`  ... and ${deletable.length - 10} more`);
        }
        log('');
    }

    log(`Total retained deployments: ${totalDeployments}`);
    log(`Deletable previews: ${totalDeletable}`);

    if (dryRun) {
        log('');
        log('Dry run: nothing was deleted. Re-run with --apply --confirm=prune to reclaim.');
        return;
    }

    if (totalDeletable === 0) {
        log('Nothing to delete.');
        return;
    }

    for (const project of PROJECTS) {
        const projectId = await resolveProjectId(project.name);
        const deployments = await listDeployments(projectId);
        const previews = deployments
            .filter((deployment) => !isProduction(deployment))
            .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
        const keepIds = new Set(previews.slice(0, keepCount).map((deployment) => deployment.uid));
        const deletable = previews.filter((deployment) => (
            !keepIds.has(deployment.uid)
            && /^dpl_/.test(deployment.uid || '')
            && !protectedIds.has(deployment.uid)
        ));

        for (const deployment of deletable) {
            try {
                await request(`/v13/deployments/${encodeURIComponent(deployment.uid)}`, { method: 'DELETE' });
                log(`Deleted ${deployment.uid} from ${project.name}`);
            } catch (error) {
                failures.push(`${deployment.uid}: ${error.message}`);
            }
        }
    }

    if (failures.length > 0) {
        console.error(`Failed to delete ${failures.length} deployment(s):`);
        failures.forEach((failure) => console.error(`  ${failure}`));
        process.exit(1);
    }

    log('');
    log(`Pruned ${totalDeletable} preview deployment(s).`);
};

run().catch((error) => {
    console.error(error.message);
    process.exit(1);
});