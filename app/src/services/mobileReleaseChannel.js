const AURA_RELEASES_API = 'https://api.github.com/repos/MdSaifulIslamMSI/Aura/releases?per_page=30';
const MOBILE_TAG_PREFIX = 'mobile-v';

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
  const asset = findMobileReleaseAsset(latestMobileRelease, platform);

  return {
    version,
    tagName: latestMobileRelease.tag_name,
    name: latestMobileRelease.name || latestMobileRelease.tag_name,
    notesUrl: latestMobileRelease.html_url || 'https://github.com/MdSaifulIslamMSI/Aura/releases',
    publishedAt: latestMobileRelease.published_at || '',
    assetName: asset?.name || '',
    downloadUrl: asset?.downloadUrl || latestMobileRelease.html_url || 'https://github.com/MdSaifulIslamMSI/Aura/releases',
  };
};

export default resolveLatestMobileRelease;
