import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const liveMode = process.argv.includes('--live');
const releasesPage = 'https://github.com/MdSaifulIslamMSI/Aura/releases';
const latestDesktopReleaseApi = 'https://api.github.com/repos/MdSaifulIslamMSI/Aura/releases/latest';
const releasesApi = 'https://api.github.com/repos/MdSaifulIslamMSI/Aura/releases?per_page=24';
const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/i;

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

const expectedDesktopAssetPlacements = new Map([
  ['Aura-Marketplace-Windows-x64-Setup.exe', 1],
  ['Aura-Marketplace-Windows-arm64-Setup.exe', 1],
  ['Aura-Marketplace-Windows-ia32-Setup.exe', 1],
  ['Aura-Marketplace-Windows-x64-Portable.exe', 1],
  ['Aura-Marketplace-macOS-arm64.dmg', 1],
  ['Aura-Marketplace-macOS-x64.dmg', 1],
  ['Aura-Marketplace-macOS-arm64.zip', 1],
  ['Aura-Marketplace-macOS-x64.zip', 1],
  ['Aura-Marketplace-Linux-x86_64.AppImage', 5],
  ['Aura-Marketplace-Linux-amd64.deb', 4],
  ['Aura-Marketplace-Linux-x86_64.rpm', 6],
  ['Aura-Marketplace-Linux-x64.tar.gz', 1],
  ['Aura-Marketplace-Linux-arm64.AppImage', 2],
  ['Aura-Marketplace-Linux-arm64.deb', 1],
  ['Aura-Marketplace-Linux-aarch64.rpm', 1],
  ['Aura-Marketplace-Linux-arm64.tar.gz', 1],
]);

const expectedMobileResolverSignatures = [
  'Aura-Marketplace-Android-|.aab||Android AAB Release page',
  'Aura-Marketplace-Android-|.apk|Debug APK|Android debug APK Release page',
  'Aura-Marketplace-Android-|.apk|Debug APK|Android-family debug APK Release page',
  'Aura-Marketplace-Android-|.apk|Debug APK|Harmony-compatible debug APK Release page',
  'Aura-Marketplace-iOS-Simulator-|.zip|Simulator ZIP|iOS simulator ZIP Release page',
  'Aura-Marketplace-iOS-|.ipa||Signed iPhone/iPad IPA Release page',
].sort();

const minimumAnchorPlacements = new Map([
  ['/', 1],
  ['#routes', 1],
  ['#downloads', 1],
  ['https://aurapilot.vercel.app/admin/aws-control', 2],
  ['https://github.com/MdSaifulIslamMSI/Aura/releases', 38],
  ['https://aurapilot.vercel.app', 31],
  ['https://aurapilot.netlify.app', 1],
  ['https://dbtrhsolhec1s.cloudfront.net', 1],
]);

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

const normalizeMarkupText = (text) =>
  text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const getAttribute = (markup, attribute) => {
  const escapedAttribute = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return markup.match(new RegExp(`\\s${escapedAttribute}="([^"]*)"`, 'i'))?.[1] ?? null;
};

const extractElements = (html, tagName) => [
  ...html.matchAll(new RegExp(`<${tagName}\\b[\\s\\S]*?<\\/${tagName}>`, 'gi')),
].map((match) => match[0]);

const requireAnchor = (anchors, { href, text, ariaLabel }) => {
  const matchingHref = anchors.filter((anchor) => getAttribute(anchor, 'href') === href);

  if (!matchingHref.length) {
    throw new Error(`gateway/index.html is missing required anchor href: ${href}`);
  }

  if (text && !matchingHref.some((anchor) => normalizeMarkupText(anchor).includes(text))) {
    throw new Error(`gateway/index.html anchor ${href} is missing accessible text: ${text}`);
  }

  if (ariaLabel && !matchingHref.some((anchor) => getAttribute(anchor, 'aria-label') === ariaLabel)) {
    throw new Error(`gateway/index.html anchor ${href} is missing aria-label: ${ariaLabel}`);
  }
};

const extractExactAssets = (html) => [...html.matchAll(/\sdata-release-asset="([^"]+)"/g)].map((match) => match[1]);

const requireAssetDigest = (asset, label) => {
  if (!asset || !sha256DigestPattern.test(asset.digest || '')) {
    throw new Error(`${label} is missing a GitHub release asset SHA-256 digest.`);
  }
};

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
  const styles = read('gateway/styles.css');
  const releaseLinks = read('gateway/release-links.js');
  const gatewayUi = read('gateway/gateway-ui.js');
  const platformAvailability = read('docs/platform-availability.md');
  const config = JSON.parse(read('gateway/vercel.json'));
  const exactAssets = extractExactAssets(html);
  const allowedExactAssets = new Set(desktopAssets);
  const anchors = extractElements(html, 'a');
  const platformCards = extractElements(html, 'article').filter((article) => /\sdata-platform-card(?:\s|>)/.test(article));
  const releaseResolvers = anchors.filter((anchor) =>
    /\sdata-release-(?:asset|asset-prefix|asset-suffix|channel)="/.test(anchor),
  );
  const heroWebpPath = path.join(repoRoot, 'gateway/assets/aura-gateway-hero.webp');

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

  const exactAssetPlacementCounts = new Map();
  for (const asset of exactAssets) {
    exactAssetPlacementCounts.set(asset, (exactAssetPlacementCounts.get(asset) || 0) + 1);
  }

  for (const [asset, expectedCount] of expectedDesktopAssetPlacements) {
    const actualCount = exactAssetPlacementCounts.get(asset) || 0;
    if (actualCount !== expectedCount) {
      throw new Error(`Gateway desktop resolver placement changed for ${asset}: expected ${expectedCount}, found ${actualCount}.`);
    }
  }

  const anchorPlacementCounts = new Map();
  for (const anchor of anchors) {
    const href = getAttribute(anchor, 'href');
    if (href) {
      anchorPlacementCounts.set(href, (anchorPlacementCounts.get(href) || 0) + 1);
    }
  }

  for (const [href, minimumCount] of minimumAnchorPlacements) {
    const actualCount = anchorPlacementCounts.get(href) || 0;
    if (actualCount < minimumCount) {
      throw new Error(`Gateway removed an existing href placement for ${href}: expected at least ${minimumCount}, found ${actualCount}.`);
    }
  }

  const runtimeRoutes = [
    { href: '/', text: 'Aura Gateway' },
    { href: '#routes', text: 'Storefronts' },
    { href: '#downloads', text: 'Downloads' },
    { href: '#contract', text: 'Trust' },
    { href: 'https://aurapilot.vercel.app', text: 'aurapilot.vercel.app' },
    { href: 'https://aurapilot.netlify.app', text: 'aurapilot.netlify.app' },
    { href: 'https://dbtrhsolhec1s.cloudfront.net', text: 'dbtrhsolhec1s.cloudfront.net' },
    {
      href: 'https://aurapilot.vercel.app/admin/aws-control',
      ariaLabel: 'AWS Control, admin-only',
    },
    { href: releasesPage, text: 'Releases' },
  ];

  for (const route of runtimeRoutes) {
    requireAnchor(anchors, route);
  }

  if (releaseResolvers.length !== 35) {
    throw new Error(`Gateway must preserve 35 release resolver placements; found ${releaseResolvers.length}.`);
  }

  for (const resolver of releaseResolvers) {
    if (getAttribute(resolver, 'href') !== releasesPage) {
      throw new Error(`Gateway release resolver must start with the GitHub Releases fallback: ${normalizeMarkupText(resolver)}`);
    }
  }

  const mobileResolverSignatures = releaseResolvers
    .filter((anchor) => getAttribute(anchor, 'data-release-channel') === 'mobile')
    .map((anchor) =>
      [
        getAttribute(anchor, 'data-release-asset-prefix') || '',
        getAttribute(anchor, 'data-release-asset-suffix') || '',
        getAttribute(anchor, 'data-release-ready-label') || '',
        normalizeMarkupText(anchor),
      ].join('|'),
    )
    .sort();

  if (JSON.stringify(mobileResolverSignatures) !== JSON.stringify(expectedMobileResolverSignatures)) {
    throw new Error(
      `Gateway mobile resolver placements changed. Expected ${JSON.stringify(expectedMobileResolverSignatures)}, found ${JSON.stringify(mobileResolverSignatures)}.`,
    );
  }

  const requireMobileResolver = ({ suffix, label, readyLabel }) => {
    const resolver = releaseResolvers.find(
      (anchor) =>
        getAttribute(anchor, 'data-release-channel') === 'mobile' &&
        getAttribute(anchor, 'data-release-asset-suffix') === suffix &&
        normalizeMarkupText(anchor).includes(label) &&
        (!readyLabel || getAttribute(anchor, 'data-release-ready-label') === readyLabel),
    );

    if (!resolver) {
      throw new Error(`Gateway is missing the ${label} mobile release resolver.`);
    }
  };

  requireMobileResolver({ suffix: '.apk', label: 'Android debug APK', readyLabel: 'Debug APK' });
  requireMobileResolver({ suffix: '.aab', label: 'Android AAB' });
  requireMobileResolver({ suffix: '.ipa', label: 'Signed iPhone/iPad IPA' });
  requireMobileResolver({ suffix: '.zip', label: 'iOS simulator ZIP', readyLabel: 'Simulator ZIP' });

  if (platformCards.length !== 36) {
    throw new Error(`Gateway platform matrix must preserve all 36 cards; found ${platformCards.length}.`);
  }

  const platformCategories = new Set(platformCards.map((card) => getAttribute(card, 'data-platform-category')));
  for (const category of ['desktop', 'mobile', 'browser', 'linux', 'embedded', 'specialized']) {
    if (!platformCategories.has(category)) {
      throw new Error(`Gateway platform matrix is missing category: ${category}`);
    }
  }

  for (const label of platformLabels) {
    requireIncludes('gateway/index.html', html, label);
  }

  requireText('gateway/index.html', html, 'Use Aura on the device you actually use.');
  requireText('gateway/index.html', html, 'Native desktop coverage is real for Windows, macOS, and Linux');
  requireText('gateway/index.html', html, 'The current mobile lane publishes a debug APK, not a store-signed Play release.');
  requireText('gateway/index.html', html, 'no signed IPA is published in the current mobile release.');

  for (const warning of [
    'Free Windows builds are unsigned, so Microsoft Defender SmartScreen may warn on first launch.',
    'Use HTTPS/MQTT-capable firmware or a gateway bridge.',
    'Keep payments, account access, checkout, and admin tasks on Aura web, mobile, or desktop surfaces.',
    'No native Symbian package is produced.',
    'Keep account, checkout, payment, and admin workflows on full Aura web, mobile, or desktop clients.',
    'Keep account, checkout, payment, and admin workflows on web, desktop, or mobile.',
  ]) {
    requireText('gateway/index.html', html, warning);
  }

  for (const warningId of [
    'windows-release-warning',
    'android-release-warning',
    'ios-release-warning',
    'rtos-safety-warning',
    'vxworks-safety-warning',
    'symbian-safety-warning',
    'kaspersky-safety-warning',
    'embedded-safety-warning',
  ]) {
    requireIncludes('gateway/index.html', html, `id="${warningId}"`);
    requireIncludes('gateway/index.html', html, `aria-describedby="${warningId}"`);
  }

  if ((html.match(/<h1\b/gi) || []).length !== 1) {
    throw new Error('Gateway must render exactly one h1.');
  }

  requireText('gateway/index.html', html, 'One Aura Gateway.');
  requireText('gateway/index.html', html, 'Every production lane.');
  requireIncludes('gateway/index.html', html, 'class="skip-link" href="#main-content"');
  requireIncludes('gateway/index.html', html, '<main id="main-content" tabindex="-1">');
  requireIncludes('gateway/index.html', html, '<footer class="gateway-footer">');
  requireIncludes('gateway/index.html', html, 'data-platform-tools hidden');
  requireIncludes('gateway/index.html', html, '<script src="./gateway-ui.js" defer></script>');

  const blockedFontHosts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
  const externalResourceUrls = [...`${html}\n${styles}`.matchAll(/(?:https?:)?\/\/[^\s"'()<>]+/gi)];

  for (const [resourceUrl] of externalResourceUrls) {
    const parsedResourceUrl = new URL(resourceUrl, 'https://aura-gateway.vercel.app');
    if (blockedFontHosts.has(parsedResourceUrl.hostname.toLowerCase())) {
      throw new Error('Gateway must not add remote font requests to the critical rendering path.');
    }
  }

  if (!existsSync(heroWebpPath)) {
    throw new Error('Gateway is missing the optimized WebP hero asset.');
  }

  const heroWebpBytes = statSync(heroWebpPath).size;
  if (heroWebpBytes > 250_000) {
    throw new Error(`Optimized gateway hero exceeds the 250 KB transfer budget: ${heroWebpBytes} bytes.`);
  }

  requireIncludes('gateway/index.html', html, './assets/aura-gateway-hero.webp');
  requireIncludes('gateway/index.html', html, './assets/aura-gateway-hero.png');

  for (const [name, source] of [
    ['gateway/release-links.js', releaseLinks],
    ['gateway/gateway-ui.js', gatewayUi],
  ]) {
    try {
      Function(source);
    } catch (error) {
      throw new Error(`${name} is not valid JavaScript: ${error.message}`);
    }
  }

  requireIncludes('gateway/release-links.js', releaseLinks, 'markUnavailable');
  requireIncludes('gateway/release-links.js', releaseLinks, 'aria-disabled');
  requireIncludes('gateway/release-links.js', releaseLinks, 'releaseReadyLabel');
  requireIncludes('gateway/release-links.js', releaseLinks, 'sha256DigestPattern');
  requireIncludes('gateway/release-links.js', releaseLinks, 'releaseChecksum');
  requireIncludes('gateway/release-links.js', releaseLinks, 'checksumDownload');
  requireIncludes('gateway/release-links.js', releaseLinks, 'aura-release-sha256s.txt');
  requireIncludes('gateway/release-links.js', releaseLinks, 'SHA-256 checksums ready');
  requireIncludes('gateway/release-links.js', releaseLinks, 'setReleaseStatus');
  requireIncludes('gateway/release-links.js', releaseLinks, 'SHA-256 checksum available in the release manifest.');
  if (releaseLinks.includes('markPending')) {
    throw new Error('release-links.js must fail closed with checking/unknown/unavailable states, not the old pending-only state.');
  }

  requireText('gateway/index.html', html, 'Loading SHA-256 checksums');
  requireText('gateway/index.html', html, 'Download checksums');
  requireIncludes('gateway/index.html', html, 'data-release-checksum-status');
  requireIncludes('gateway/index.html', html, 'data-release-checksum-manifest');
  requireIncludes('gateway/index.html', html, 'data-release-checksum-download');
  requireIncludes('gateway/styles.css', styles, '.release-checksums');
  requireIncludes('gateway/styles.css', styles, '.checksum-download-link');
  requireIncludes('gateway/styles.css', styles, ':focus-visible');
  requireIncludes('gateway/styles.css', styles, '@media (prefers-reduced-motion: reduce)');
  requireIncludes('gateway/styles.css', styles, '@media (forced-colors: active)');
  requireIncludes('gateway/gateway-ui.js', gatewayUi, 'data-platform-filter');
  requireIncludes('gateway/gateway-ui.js', gatewayUi, 'data-device-cta');
  requireIncludes('gateway/gateway-ui.js', gatewayUi, 'renderPlatformMatrix');

  requireText('docs/platform-availability.md', platformAvailability, '## Current Release Asset Contract');
  requireText('docs/platform-availability.md', platformAvailability, '## Release Checksum Contract');
  requireText('docs/platform-availability.md', platformAvailability, 'The gateway treats GitHub release asset `sha256:` digests as the live checksum source.');
  requireText('docs/platform-availability.md', platformAvailability, 'A direct download button must not be marked ready unless the GitHub release asset includes a SHA-256 digest.');
  requireText('docs/platform-availability.md', platformAvailability, '| Android Play release | Not published in current release | AAB |');
  requireText('docs/platform-availability.md', platformAvailability, '| iPhone/iPad real-device install | Not published in current release | signed IPA |');
  requireText('docs/platform-availability.md', platformAvailability, '| Long-tail and embedded OS families | PWA or companion/API mode | no native binary |');
  requireText('docs/platform-availability.md', platformAvailability, 'Do not add a gateway download button for a platform-specific binary until a real release asset exists.');

  if (config.outputDirectory !== '.') {
    throw new Error('gateway/vercel.json must deploy the static gateway root as outputDirectory ".".');
  }

  return {
    exactAssetCount: exactAssets.length,
    approvedExactAssetCount: allowedExactAssets.size,
    releaseResolverCount: releaseResolvers.length,
    platformCardCount: platformCards.length,
    heroWebpBytes,
  };
};

const validateLiveReleaseContract = async () => {
  const desktopRelease = await fetchJson(latestDesktopReleaseApi);
  const desktopAssetsByName = new Map((desktopRelease.assets || []).map((asset) => [asset.name, asset]));

  for (const asset of desktopAssets) {
    if (!desktopAssetsByName.has(asset)) {
      throw new Error(`Latest desktop release is missing required gateway asset: ${asset}`);
    }

    requireAssetDigest(desktopAssetsByName.get(asset), `Latest desktop release asset ${asset}`);
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

  const mobileAssets = mobileRelease.assets || [];
  const androidApk = mobileAssets.find((asset) => asset.name.startsWith('Aura-Marketplace-Android-') && asset.name.endsWith('.apk'));
  const iosSimulator = mobileAssets.find(
    (asset) => asset.name.startsWith('Aura-Marketplace-iOS-Simulator-') && asset.name.endsWith('.zip'),
  );
  const hasAndroidAab = mobileAssets.some((asset) => asset.name.startsWith('Aura-Marketplace-Android-') && asset.name.endsWith('.aab'));
  const hasSignedIpa = mobileAssets.some(
    (asset) =>
      asset.name.startsWith('Aura-Marketplace-iOS-') &&
      !asset.name.startsWith('Aura-Marketplace-iOS-Simulator-') &&
      asset.name.endsWith('.ipa'),
  );

  if (!androidApk) {
    throw new Error(`Mobile release ${mobileRelease.tag_name} is missing the Android APK expected by the gateway.`);
  }

  requireAssetDigest(androidApk, `Mobile release ${mobileRelease.tag_name} Android APK`);

  if (!iosSimulator) {
    throw new Error(`Mobile release ${mobileRelease.tag_name} is missing the iOS simulator ZIP expected by the gateway.`);
  }

  requireAssetDigest(iosSimulator, `Mobile release ${mobileRelease.tag_name} iOS simulator ZIP`);

  if (hasAndroidAab || hasSignedIpa) {
    throw new Error(
      `Mobile release ${mobileRelease.tag_name} now contains signed/store assets. Update the gateway and platform contract before shipping.`,
    );
  }

  return {
    desktopRelease: desktopRelease.tag_name,
    mobileRelease: mobileRelease.tag_name,
    desktopDigestCount: desktopAssets.length,
    mobileDigestCount: 2,
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
