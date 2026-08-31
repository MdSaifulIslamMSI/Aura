#!/usr/bin/env node
'use strict';

/**
 * Option-A WAF cutoff: disassociate the Aura login-security WAFv2 WebACL from
 * every CloudFront distribution that references it, WITHOUT deleting the
 * CloudFormation stack. The WebACL, its rules, and its configuration remain
 * in us-east-1 and can be re-attached at any time (rollback command printed
 * at the end of an apply, and the pre-change distribution config snapshot is
 * written to reports/waf-disassociate/).
 *
 * Dry-run by default. Mutating requires --apply.
 *
 * Usage:
 *   node scripts/security/disassociate-login-waf-cloudfront.mjs \
 *     --webacl-name aura-login-security-production [--apply] [--distribution <id>]
 *
 * Prerequisites:
 *   - AWS credentials with cloudfront:ListDistributions/GetDistributionConfig/
 *    UpdateDistribution and wafv2:ListWebACLs. CloudFront-scope WAFv2 lives
 *    in us-east-1 only; this script pins that region for every wafv2 call.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const WAF_REGION = 'us-east-1';

const parseArgs = (argv) => {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--webacl-name') args.webaclName = argv[++i];
    else if (arg === '--distribution') args.distributionId = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
};

const runAws = (args) => {
  // No shell: the AWS CLI v2 is a real executable, and shell mode mangles
  // arguments containing spaces (e.g. fileb:// paths under this repo).
  const result = spawnSync('aws', args, { encoding: 'utf8' });
  if (result.error) throw new Error(`Failed to spawn aws CLI: ${result.error.message}`);
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    if (/NoCredentials|ExpiredToken|Unable to locate credentials/i.test(stderr)) {
      throw new Error('AWS credentials are not available. Authenticate first (e.g. "aws login" or "aws sso login"), then re-run.');
    }
    throw new Error(`aws ${args[0]} failed (${result.status}): ${stderr.slice(0, 500)}`);
  }
  return JSON.parse(result.stdout || '{}');
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.webaclName) {
    console.log('Usage: node scripts/security/disassociate-login-waf-cloudfront.mjs --webacl-name <name> [--apply] [--distribution <id>]');
    process.exit(args.help ? 0 : 1);
  }

  console.log(`[waf-cutoff] locating CloudFront-scope WebACL "${args.webaclName}" in ${WAF_REGION}...`);
  const webAcls = runAws(['wafv2', 'list-web-acls', '--scope', 'CLOUDFRONT', '--region', WAF_REGION, '--output', 'json'])
    .WebACLs || [];
  const webAcl = webAcls.find((a) => a.Name === args.webaclName);
  if (!webAcl) {
    console.error(`[waf-cutoff] no WebACL named "${args.webaclName}" found. Existing: ${webAcls.map((a) => a.Name).join(', ') || '(none)'}`);
    process.exit(1);
  }
  console.log(`[waf-cutoff] found WebACL ${webAcl.ARN}`);

  console.log('[waf-cutoff] scanning CloudFront distributions for attachments...');
  // NOTE: list-distributions summaries do NOT include DistributionConfig,
  // so each distribution must be inspected with get-distribution.
  const distributions = [];
  let marker;
  do {
    const pageArgs = ['cloudfront', 'list-distributions', '--output', 'json'];
    if (marker) pageArgs.push('--Marker', marker);
    const page = runAws(pageArgs);
    distributions.push(...((page.DistributionList?.Items || [])));
    marker = page.DistributionList?.IsTruncated ? page.DistributionList.NextMarker : undefined;
  } while (marker);

  const attached = [];
  for (const item of distributions) {
    const full = runAws(['cloudfront', 'get-distribution', '--id', item.Id, '--output', 'json']);
    const config = full.Distribution?.DistributionConfig;
    if (config?.WebACLId === webAcl.ARN) {
      attached.push({ Id: item.Id, DomainName: item.DomainName, Config: config });
    }
  }
  if (attached.length === 0) {
    console.log('[waf-cutoff] no CloudFront distribution references this WebACL. Nothing to do.');
    process.exit(0);
  }
  for (const d of attached) {
    console.log(`[waf-cutoff] attached: ${d.Id} (${d.DomainName || 'no-domain'}) aliases=${(d.Config?.Aliases?.Items || []).join(',') || 'none'}`);
  }

  const targets = args.distributionId
    ? attached.filter((d) => d.Id === args.distributionId)
    : attached;
  if (targets.length === 0) {
    console.error(`[waf-cutoff] distribution ${args.distributionId} does not reference this WebACL.`);
    process.exit(1);
  }

  if (!args.apply) {
    console.log('[waf-cutoff] DRY RUN — re-run with --apply to disassociate the target(s) above.');
    console.log('[waf-cutoff] The WebACL stays deployed in us-east-1; rollback is trivial (re-set WebACLId).');
    process.exit(0);
  }

  const snapshotDir = path.join(REPO_ROOT, 'reports', 'waf-disassociate');
  fs.mkdirSync(snapshotDir, { recursive: true });

  for (const target of targets) {
    const current = runAws(['cloudfront', 'get-distribution-config', '--id', target.Id, '--output', 'json']);
    const etag = current.ETag;
    const config = current.DistributionConfig;
    if (config.WebACLId !== webAcl.ARN) {
      console.log(`[waf-cutoff] ${target.Id} no longer references the WebACL; skipping.`);
      continue;
    }

    const snapshotPath = path.join(snapshotDir, `${target.Id}-${Date.now()}.json`);
    fs.writeFileSync(snapshotPath, JSON.stringify({ ETag: etag, DistributionConfig: config, WebAclArn: webAcl.ARN }, null, 2));
    console.log(`[waf-cutoff] ${target.Id}: pre-change config snapshot -> ${path.relative(REPO_ROOT, snapshotPath)}`);

    config.WebACLId = '';
    // NOTE: `--if-match` + `--distribution-config fileb://` trips a bug in the
    // CLI's update-distribution argument customization ("'in <string>'
    // requires string as left operand, not int"). --cli-input-json bypasses it.
    const unquotedEtag = String(etag).replace(/"/g, '');
    const inputPath = path.join(snapshotDir, `${target.Id}-update-input.json`);
    fs.writeFileSync(inputPath, JSON.stringify({ Id: target.Id, IfMatch: unquotedEtag, DistributionConfig: config }));

    runAws(['cloudfront', 'update-distribution', '--cli-input-json', `fileb://${inputPath}`, '--output', 'json']);
    console.log(`[waf-cutoff] ${target.Id}: update-distribution accepted (propagation can take a few minutes).`);

    const verify = runAws(['cloudfront', 'get-distribution', '--id', target.Id, '--output', 'json']);
    const stillAttached = verify.Distribution?.DistributionConfig?.WebACLId;
    if (stillAttached) {
      console.error(`[waf-cutoff] ${target.Id}: verification FAILED, WebACLId still set to ${stillAttached}.`);
      process.exitCode = 1;
    } else {
      console.log(`[waf-cutoff] ${target.Id}: verified — WebACLId is empty. WAF is no longer in the request path.`);
      console.log(`[waf-cutoff] ${target.Id}: ROLLBACK — re-attach with:`);
      console.log(`  aws cloudfront get-distribution-config --id ${target.Id} --output json > cfg.json # then set WebACLId to ${webAcl.ARN}`);
      console.log(`  aws cloudfront update-distribution --id ${target.Id} --if-match <new-etag> --distribution-config fileb://cfg.json`);
    }
    fs.rmSync(inputPath, { force: true });
  }

  console.log('[waf-cutoff] done. The WebACL stack remains deployed in us-east-1 for rollback.');
};

try {
  if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
  }
} catch (error) {
  console.error(`[waf-cutoff] ${error.message}`);
  process.exit(1);
}
