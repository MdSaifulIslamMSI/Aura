import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const liveMode = process.argv.includes('--live');
const releasesPage = 'https://github.com/MdSaifulIslamMSI/Aura/releases';
const latestDesktopReleaseApi = 'https://api.github.com/repos/MdSaifulIslamMSI/Aura/releases/latest';
const releasesApi = 'https://api.github.com/repos/MdSaifulIslamMSI/Aura/releases?per_page=24';

const desktopAssets = [
  'Aura-Marketplace-Windows-x64-Setup.exe',
  'Aura-Marketplace-Windows-arm64-Setup.exe',
  'Aura-Marketplace-Windows-ia32-Setup.exe',
  'Aura-Marketplace-Windows-x64-Portable.exe',
  'Aura-Marketplace-macOS-arm64.dmg',
  'Aura-Marketplace-macOS-x64.dmg',
  'Aura-Marketplace-macOS-arm64.zip',
  'Aura-Marketplace-macOS-x64.zip',
  'Aura-Marketplace-Linux-x86_64.AppImage',
  'Aura-Marketplace-Linux-amd64.deb',
  'Aura-Marketplace-Linux-x86_64.rpm',
  'Aura-Marketplace-Linux-x64.tar.gz',
  'Aura-Marketplace-Linux-arm64.AppImage',
  'Aura-Marketplace-Linux-arm64.deb',
  'Aura-Marketplace-Linux-aarch64.rpm',
  'Aura-Marketplace-Linux-arm64.tar.gz',
];

const platformLabels = [
  'Ubuntu/Debian deb',
  'Fedora/RHEL RPM',
  'iPadOS PWA',
  'ChromeOS',
  'Unix / BSD',
  'HarmonyOS',
  'FreeRTOS / RTOS family',
  'BOSS Linux family',
  'Maya OS',
  'Garuda Linux',
  'BharOS, JioOS, and Indus',
  'JioTele OS',
  'watchOS',
  'tvOS',
  'Red Hat Enterprise Linux',
  'VxWorks',
  'Linux / GNU-Linux family',
  'SUSE Linux Enterprise + openSUSE',
  'Raspberry Pi OS',
  'Sailfish OS',
  'MINIX + RISC OS',
  'Symbian OS',
  'Mageia',
  'Astra Linux, ALT Linux, RED OS, and ROSA Linux',
  'Aurora OS',
  'KasperskyOS',
  'Elbrus Linux / Elbrus OS',
  'Calculate Linux',
  'KolibriOS + Phantom OS',
  'HarmonyOS / Hongmeng OS + OpenHarmony',
  'Kylin OS, Galaxy Kylin, UOS, and deepin Linux',
  'openEuler, Anolis OS, and TencentOS Server',
  'AliOS, AliOS Things, and RT-Thread',
];

const read = (relativePath) => {
  const absolutePath = path.join(repoRoot, relativePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Missing required gateway contract file: ${relativePath}`);
  }

  return readFileSync(absolutePath, 'utf8');
};

const requireIncludes = (name, text, expected) => {
  if (!text.includes(expected)) {
    throw new Error(`${name} is missing expected text: ${expected}`);
  }
};

const requireText = (name, text, expected) => {
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  const normalizedExpected = expected.replace(/\s+/g, ' ').trim();

  if (!normalizedText.includes(normalizedExpected)) {
    throw new Error(`${name} is missing expected text: ${expected}`);
  }
};

const requireRegex = (name, text, pattern) => {
  if (!pattern.test(text)) {
    throw new Error(`${name} is missing expected pattern: ${pattern}`);
  }
};

const extractExactAssets = (html) => [...html.matchAll(/\sdata-release-asset="([^"]+)"/g)].map((match) => match[1]);

const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'aura-gateway-release-contract',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub release API request failed for ${url}: ${response.status}`);
  }

  return response.json();
};

const validateStaticContract = () => {
  const html = read('gateway/index.html');
  const releaseLinks = read('gateway/release-links.js');
  const platformAvailability = read('docs/platform-availability.md');
  const config = JSON.parse(read('gateway/vercel.json'));
  const exactAssets = extractExactAssets(html);
  const allowedExactAssets = new Set(desktopAssets);

  if (html.includes('/releases/latest/download/')) {
    throw new Error('Gateway must not link directly to latest/download assets before release resolution.');
  }

  for (const asset of desktopAssets) {
    if (!exactAssets.includes(asset)) {
      throw new Error(`Missing gateway download resolver asset: ${asset}`);
    }
  }

  for (const asset of exactAssets) {
    if (!allowedExactAssets.has(asset)) {
      throw new Error(`Gateway exact asset is not in the approved desktop release asset set: ${asset}`);
    }
  }

  for (const label of platformLabels) {
    requireIncludes('gateway/index.html', html, label);
  }

  requireText('gateway/index.html', html, 'Use Aura on the device you actually use.');
  requireText('gateway/index.html', html, 'Native desktop coverage is real for Windows, macOS, and Linux');
  requireText('gateway/index.html', html, 'The current mobile lane publishes a debug APK, not a store-signed Play release.');
  requireText('gateway/index.html', html, 'no signed IPA is published in the current mobile release.');

  requireRegex('Android debug APK resolver', html, /data-release-asset-suffix="\.apk"[\s\S]*data-release-ready-label="Debug APK"[\s\S]*<span>Android debug APK<\/span>/);
  requireRegex('Android AAB unpublished resolver', html, /data-release-asset-suffix="\.aab"[\s\S]*<span>Android AAB<\/span>/);
  requireRegex('Signed IPA unpublished resolver', html, /data-release-asset-suffix="\.ipa"[\s\S]*<span>Signed iPhone\/iPad IPA<\/span>/);
  requireRegex('iOS simulator resolver', html, /data-release-asset-suffix="\.zip"[\s\S]*data-release-ready-label="Simulator ZIP"/);

  requireIncludes('gateway/release-links.js', releaseLinks, 'markUnavailable');
  requireIncludes('gateway/release-links.js', releaseLinks, 'aria-disabled');
  requireIncludes('gateway/release-links.js', releaseLinks, 'releaseReadyLabel');
  if (releaseLinks.includes('markPending')) {
    throw new Error('release-links.js must fail closed with checking/unknown/unavailable states, not the old pending-only state.');
  }

  requireText('docs/platform-availability.md', platformAvailability, '## Current Release Asset Contract');
  requireText('docs/platform-availability.md', platformAvailability, '| Android Play release | Not published in current release | AAB |');
  requireText('docs/platform-availability.md', platformAvailability, '| iPhone/iPad real-device install | Not published in current release | signed IPA |');
  requireText('docs/platform-availability.md', platformAvailability, '| Long-tail and embedded OS families | PWA or companion/API mode | no native binary |');
  requireText('docs/platform-availability.md', platformAvailability, 'Do not add a gateway download button for a platform-specific binary until a real release asset exists.');

  if (config.outputDirectory !== '.') {
    throw new Error('gateway/vercel.json must deploy the static gateway root as outputDirectory ".".');
  }

  return { exactAssetCount: exactAssets.length, approvedExactAssetCount: allowedExactAssets.size };
};

const validateLiveReleaseContract = async () => {
  const desktopRelease = await fetchJson(latestDesktopReleaseApi);
  const desktopAssetNames = new Set((desktopRelease.assets || []).map((asset) => asset.name));

  for (const asset of desktopAssets) {
    if (!desktopAssetNames.has(asset)) {
      throw new Error(`Latest desktop release is missing required gateway asset: ${asset}`);
    }
  }

  const releases = await fetchJson(releasesApi);
  const mobileRelease = (releases || []).find(
    (release) =>
      !release.draft &&
      !release.prerelease &&
      typeof release.tag_name === 'string' &&
      release.tag_name.startsWith('mobile-v'),
  );

  if (!mobileRelease) {
    throw new Error('No published non-prerelease mobile-v release found.');
  }

  const mobileAssetNames = (mobileRelease.assets || []).map((asset) => asset.name);
  const hasAndroidApk = mobileAssetNames.some((asset) => asset.startsWith('Aura-Marketplace-Android-') && asset.endsWith('.apk'));
  const hasIosSimulator = mobileAssetNames.some(
    (asset) => asset.startsWith('Aura-Marketplace-iOS-Simulator-') && asset.endsWith('.zip'),
  );
  const hasAndroidAab = mobileAssetNames.some((asset) => asset.startsWith('Aura-Marketplace-Android-') && asset.endsWith('.aab'));
  const hasSignedIpa = mobileAssetNames.some(
    (asset) => asset.startsWith('Aura-Marketplace-iOS-') && !asset.startsWith('Aura-Marketplace-iOS-Simulator-') && asset.endsWith('.ipa'),
  );

  if (!hasAndroidApk) {
    throw new Error(`Mobile release ${mobileRelease.tag_name} is missing the Android APK expected by the gateway.`);
  }

  if (!hasIosSimulator) {
    throw new Error(`Mobile release ${mobileRelease.tag_name} is missing the iOS simulator ZIP expected by the gateway.`);
  }

  if (hasAndroidAab || hasSignedIpa) {
    throw new Error(
      `Mobile release ${mobileRelease.tag_name} now contains signed/store assets. Update the gateway and platform contract before shipping.`,
    );
  }

  return {
    desktopRelease: desktopRelease.tag_name,
    mobileRelease: mobileRelease.tag_name,
    releasesPage,
  };
};

const staticResult = validateStaticContract();
let liveResult = null;

if (liveMode) {
  liveResult = await validateLiveReleaseContract();
}

console.log(
  JSON.stringify(
    {
      ok: true,
      static: staticResult,
      live: liveResult,
    },
    null,
    2,
  ),
);
