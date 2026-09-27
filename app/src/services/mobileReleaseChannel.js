const AURA_RELEASES_API = 'https://api.github.com/repos/MdSaifulIslamMSI/Aura/releases?per_page=30';
const MOBILE_TAG_PREFIX = 'mobile-v';
// Only release assets hosted on the Aura repo's own GitHub Releases download
// origin may be offered for install; anything else falls back to the release
// page so a tampered API payload can never turn the banner into an arbitrary
// APK download link.
const TRUSTED_DOWNLOAD_BASE = 'https://github.com/MdSaifulIslamMSI/Aura/releases/download/';
const MANIFEST_ASSET_PREFIX = 'Aura-Mobile-Release-Manifest-';

const MOBILE_ASSET_PATTERNS = Object.freeze({
  android: [
    /^Aura-Marketplace-Android-.+\.apk$/i,
    /^Aura-Marketplace-Android-.+\.aab$/i,
  ],
  ios: [
    /^Aura-Marketplace-iOS-.+\.ipa$/i,
    /^Aura-Marketplace-iOS-Simulator-.+\.zip$/i,
  ],
});

const normalizeVersion = (value = '') => String(value || '')
  .trim()
  .replace(new RegExp(`^${MOBILE_TAG_PREFIX}`, 'i'), '')
  .replace(/^v/i, '');

export const parseMobileVersion = (value = '') => {
  const normalized = normalizeVersion(value);
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;

  return match.slice(1).map((part) => Number.parseInt(part, 10));
};

export const compareMobileVersions = (left = '', right = '') => {
  const leftParts = parseMobileVersion(left);
  const rightParts = parseMobileVersion(right);

  if (!leftParts || !rightParts) {
    return 0;
  }

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }

  return 0;
};

const isMobileRelease = (release = {}) => (
  !release.draft
  && !release.prerelease
  && typeof release.tag_name === 'string'
  && release.tag_name.startsWith(MOBILE_TAG_PREFIX)
);

export const isTrustedReleaseDownloadUrl = (downloadUrl = '', tagName = '') => (
  typeof downloadUrl === 'string'
  && downloadUrl.startsWith(`${TRUSTED_DOWNLOAD_BASE}${tagName}/`)
);

const resolveTrustedDownloadUrl = (asset = {}, tagName = '') => {
  if (asset?.downloadUrl && isTrustedReleaseDownloadUrl(asset.downloadUrl, tagName)) {
    return asset.downloadUrl;
  }
  return '';
};

const fetchReleaseAssetDigest = async ({ tagName, version, assetName, fetchImpl, fallbackUrl }) => {
  if (!tagName || !version || !assetName || typeof fetchImpl !== 'function') {
    return '';
  }

  try {
    const manifestUrl = `${TRUSTED_DOWNLOAD_BASE}${tagName}/${encodeURIComponent(
      `${MANIFEST_ASSET_PREFIX}${version}.json`
    )}`;
    const response = await fetchImpl(manifestUrl, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return '';

    const manifest = await response.json();
    const entry = (Array.isArray(manifest?.assets) ? manifest.assets : [])
      .find((item) => item?.name === assetName && isTrustedReleaseDownloadUrl(item?.downloadUrl, tagName));
    const digest = String(entry?.sha256 || '').toLowerCase();
    return /^[0-9a-f]{64}$/.test(digest) ? digest : '';
  } catch {
    // Digests are best-effort: a missing or unreadable manifest simply
    // means the banner shows no checksum for this release.
    return '';
  }
};

export const findMobileReleaseAsset = (release = {}, platform = '') => {
  const patterns = MOBILE_ASSET_PATTERNS[platform] || [];
  const assets = Array.isArray(release.assets) ? release.assets : [];

  for (const pattern of patterns) {
    const match = assets.find((asset) => pattern.test(String(asset?.name || '')));
    if (match?.browser_download_url) {
      return {
        name: match.name,
        downloadUrl: match.browser_download_url,
      };
    }
  }

  return null;
};

export const resolveLatestMobileRelease = async ({ platform = '', fetchImpl = fetch } = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch is not available for the Aura mobile release channel.');
  }

  const response = await fetchImpl(AURA_RELEASES_API, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Aura mobile release channel returned ${response.status}`);
  }

  const releases = await response.json();
  const latestMobileRelease = (Array.isArray(releases) ? releases : []).find(isMobileRelease);

  if (!latestMobileRelease) {
    return null;
  }

  const version = normalizeVersion(latestMobileRelease.tag_name);
  const tagName = latestMobileRelease.tag_name;
  const asset = findMobileReleaseAsset(latestMobileRelease, platform);
  const fallbackUrl = latestMobileRelease.html_url || 'https://github.com/MdSaifulIslamMSI/Aura/releases';
  const trustedDownloadUrl = asset ? resolveTrustedDownloadUrl(asset, tagName) : '';
  const downloadUrl = trustedDownloadUrl || fallbackUrl;
  const sha256 = trustedDownloadUrl
    ? await fetchReleaseAssetDigest({ tagName, version, assetName: asset?.name || '', fetchImpl })
    : '';

  return {
    version,
    tagName,
    name: latestMobileRelease.name || tagName,
    notesUrl: fallbackUrl,
    publishedAt: latestMobileRelease.published_at || '',
    assetName: asset?.name || '',
    sha256,
    downloadUrl,
  };
};

export default resolveLatestMobileRelease;
