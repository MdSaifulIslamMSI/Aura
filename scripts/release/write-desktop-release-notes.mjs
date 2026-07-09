#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);

const getArg = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || '' : fallback;
};

const repoRoot = process.cwd();
const artifactsDir = path.resolve(repoRoot, getArg('--artifacts-dir', 'release-artifacts'));
const notesOut = path.resolve(repoRoot, getArg('--notes-out', 'release-notes.md'));
const checksumsOut = path.resolve(
  repoRoot,
  getArg('--checksums-out', path.join('release-artifacts', `Aura-Desktop-SHA256SUMS-${process.env.VERSION || 'unknown'}.txt`)),
);
const changesFile = getArg('--changes-file');

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
};

const version = requireEnv('VERSION');
const tagName = requireEnv('TAG_NAME');
const releaseSha = requireEnv('RELEASE_SHA');
const workflowUrl = requireEnv('WORKFLOW_URL');
const repository = process.env.GITHUB_REPOSITORY || 'MdSaifulIslamMSI/Aura';
const rangeLabel = process.env.RANGE_LABEL || 'Recent release context';
const requireWindowsSigning = process.env.REQUIRE_WINDOWS_SIGNING === 'true';
const requireMacosSigning = process.env.REQUIRE_MACOS_SIGNING === 'true';
const publishStoreRelease = process.env.PUBLISH_STORE_RELEASE === 'true';

const releaseUrl = `https://github.com/${repository}/releases/tag/${tagName}`;
const gatewayUrl = 'https://aura-gateway.vercel.app';

const sha256File = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });

const formatBytes = (bytes) => {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${bytes} B`;
};

const describeArtifact = (fileName) => {
  if (/Windows.*Setup\.exe$/i.test(fileName)) {
    const arch = fileName.match(/Windows-(.*?)-Setup\.exe$/i)?.[1] || 'multi-arch';
    return { platform: `Windows ${arch}`, lane: 'Installer', use: 'Normal desktop install and auto-update path' };
  }

  if (/Windows.*Portable\.exe$/i.test(fileName)) {
    const arch = fileName.match(/Windows-(.*?)-Portable\.exe$/i)?.[1] || 'multi-arch';
    return { platform: `Windows ${arch}`, lane: 'Portable', use: 'Run without installer where policy allows' };
  }

  if (/macOS.*\.dmg$/i.test(fileName)) {
    const arch = fileName.includes('arm64') ? 'Apple Silicon' : 'Intel';
    return { platform: `macOS ${arch}`, lane: 'DMG', use: 'Standard Mac desktop install' };
  }

  if (/macOS.*\.zip$/i.test(fileName)) {
    const arch = fileName.includes('arm64') ? 'Apple Silicon' : 'Intel';
    return { platform: `macOS ${arch}`, lane: 'ZIP', use: 'Advanced/manual Mac install' };
  }

  if (/\.AppImage$/i.test(fileName)) {
    const arch = fileName.includes('arm64') ? 'ARM64' : 'x64';
    return { platform: `Linux ${arch}`, lane: 'AppImage', use: 'Portable Linux desktop launch' };
  }

  if (/\.deb$/i.test(fileName)) {
    const arch = fileName.includes('arm64') ? 'ARM64' : 'x64';
    return { platform: `Linux ${arch}`, lane: 'deb', use: 'Ubuntu, Debian, BOSS, Maya, and compatible systems' };
  }

  if (/\.rpm$/i.test(fileName)) {
    const arch = fileName.includes('aarch64') ? 'ARM64' : 'x64';
    return { platform: `Linux ${arch}`, lane: 'RPM', use: 'Fedora, RHEL, SUSE, Mageia, ROSA, and compatible systems' };
  }

  if (/\.tar\.gz$/i.test(fileName)) {
    const arch = fileName.includes('arm64') ? 'ARM64' : 'x64';
    return { platform: `Linux ${arch}`, lane: 'tar.gz', use: 'Manual Linux extraction and controlled desktops' };
  }

  if (/\.blockmap$/i.test(fileName) || /^latest.*\.yml$/i.test(fileName)) {
    return { platform: 'Updater', lane: 'Metadata', use: 'Auto-update resolution for installed clients' };
  }

  return { platform: 'Desktop', lane: 'Artifact', use: 'Release support file' };
};

const readChanges = () => {
  if (!changesFile) {
    return [];
  }

  const absoluteChangesFile = path.resolve(repoRoot, changesFile);
  if (!existsSync(absoluteChangesFile)) {
    return [];
  }

  return readFileSync(absoluteChangesFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 18);
};

if (!existsSync(artifactsDir)) {
  throw new Error(`Desktop release artifacts directory does not exist: ${artifactsDir}`);
}

const checksumFileName = path.basename(checksumsOut);
const artifacts = readdirSync(artifactsDir)
  .filter((fileName) => fileName !== checksumFileName)
  .filter((fileName) => statSync(path.join(artifactsDir, fileName)).isFile())
  .sort((left, right) => left.localeCompare(right));

if (!artifacts.length) {
  throw new Error(`No desktop release artifacts found in ${artifactsDir}`);
}

const artifactRows = [];
const checksumLines = [
  `# Aura Marketplace Desktop ${version}`,
  `# Release: ${releaseUrl}`,
  `# Source commit: ${releaseSha}`,
];

for (const fileName of artifacts) {
  const absoluteArtifact = path.join(artifactsDir, fileName);
  const digest = await sha256File(absoluteArtifact);
  const details = describeArtifact(fileName);
  const size = formatBytes(statSync(absoluteArtifact).size);

  artifactRows.push({ fileName, digest, size, ...details });
  checksumLines.push(`${digest}  ${fileName}`);
}

mkdirSync(path.dirname(checksumsOut), { recursive: true });
writeFileSync(checksumsOut, `${checksumLines.join('\n')}\n`);

const primaryRows = artifactRows.filter((artifact) => !['Metadata', 'Artifact'].includes(artifact.lane));
const metadataRows = artifactRows.filter((artifact) => ['Metadata', 'Artifact'].includes(artifact.lane));
const changes = readChanges();

const signingLines = [
  `- Windows signing required for this run: ${requireWindowsSigning ? 'yes' : 'no'}.`,
  `- macOS signing/notarization required for this run: ${requireMacosSigning ? 'yes' : 'no'}.`,
  `- Store publication requested: ${publishStoreRelease ? 'yes' : 'no'}.`,
  '- SHA-256 checksums are published as a release asset and are also visible through the Aura Gateway.',
  '- Checksums prove file integrity after download; they do not replace Windows Authenticode, Apple Developer ID signing, macOS notarization, or store trust.',
];

const notes = [
  `# Aura Marketplace Desktop ${version}`,
  '',
  'A production desktop release for Windows, macOS, and Linux, generated by the gated Aura release workflow.',
  '',
  '## Release Highlights',
  '',
  '| Area | Status |',
  '| --- | --- |',
  `| Source commit | \`${releaseSha}\` |`,
  `| Release tag | \`${tagName}\` |`,
  `| Workflow evidence | ${workflowUrl} |`,
  `| Public gateway | ${gatewayUrl} |`,
  `| GitHub release | ${releaseUrl} |`,
  `| Primary packages | ${primaryRows.length} installers and archives |`,
  `| Update metadata | ${metadataRows.length} updater/support files |`,
  '',
  '## Choose The Right Download',
  '',
  '| Package | Platform | Lane | Size | Best for |',
  '| --- | --- | --- | ---: | --- |',
  ...primaryRows.map((artifact) => `| \`${artifact.fileName}\` | ${artifact.platform} | ${artifact.lane} | ${artifact.size} | ${artifact.use} |`),
  '',
  '## Integrity And Trust',
  '',
  `A checksum manifest is attached as \`${checksumFileName}\`. Verify a downloaded file by matching its SHA-256 digest before installing.`,
  '',
  ...signingLines,
  '',
  '## Auto-Update Files',
  '',
  metadataRows.length
    ? '| File | Purpose |\n| --- | --- |\n' +
        metadataRows.map((artifact) => `| \`${artifact.fileName}\` | ${artifact.use} |`).join('\n')
    : 'No updater metadata files were published for this release.',
  '',
  '## Install Notes',
  '',
  '| OS | Recommended path |',
  '| --- | --- |',
  '| Windows | Use the Setup installer for your CPU architecture. Portable builds are for controlled or no-install environments. |',
  '| macOS | Use Apple Silicon for M-series Macs and x64 for Intel Macs. Open unsigned builds only if you trust this GitHub release. |',
  '| Linux | Prefer AppImage for portable testing, deb for Ubuntu/Debian/BOSS/Maya, RPM for Fedora/RHEL/SUSE/Mageia/ROSA, and tar.gz for manual installs. |',
  '',
  `## ${rangeLabel}`,
  '',
  ...(changes.length ? changes : ['- No commit summary was available for this release run.']),
  '',
].join('\n');

mkdirSync(path.dirname(notesOut), { recursive: true });
writeFileSync(notesOut, notes);

console.log(`Wrote desktop release notes: ${path.relative(repoRoot, notesOut)}`);
console.log(`Wrote desktop checksums: ${path.relative(repoRoot, checksumsOut)}`);
console.log(`Desktop release artifacts described: ${artifactRows.length}`);
