import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compareMobileVersions,
  findMobileReleaseAsset,
  isTrustedReleaseDownloadUrl,
  parseMobileVersion,
  resolveLatestMobileRelease,
} from './mobileReleaseChannel';

const TRUSTED_APK_URL = 'https://github.com/MdSaifulIslamMSI/Aura/releases/download/mobile-v1.4.2/Aura-Marketplace-Android-1.4.2.apk';
const TRUSTED_MANIFEST_URL = 'https://github.com/MdSaifulIslamMSI/Aura/releases/download/mobile-v1.4.2/Aura-Mobile-Release-Manifest-1.4.2.json';
const DIGEST = 'a'.repeat(32) + 'b'.repeat(32);

describe('mobileReleaseChannel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses and compares mobile release versions', () => {
    expect(parseMobileVersion('mobile-v1.2.3')).toEqual([1, 2, 3]);
    expect(compareMobileVersions('1.2.10', '1.2.3')).toBe(1);
    expect(compareMobileVersions('mobile-v1.2.0', '1.3.0')).toBe(-1);
    expect(compareMobileVersions('1.3.0', '1.3.0')).toBe(0);
  });

  it('prefers installable platform assets', () => {
    const release = {
      assets: [
        { name: 'Aura-Marketplace-Android-1.0.5.aab', browser_download_url: 'https://example.com/aab' },
        { name: 'Aura-Marketplace-Android-1.0.5.apk', browser_download_url: 'https://example.com/apk' },
        { name: 'Aura-Marketplace-iOS-Simulator-1.0.5.zip', browser_download_url: 'https://example.com/simulator' },
        { name: 'Aura-Marketplace-iOS-1.0.5.ipa', browser_download_url: 'https://example.com/ipa' },
      ],
    };

    expect(findMobileReleaseAsset(release, 'android')).toEqual({
      name: 'Aura-Marketplace-Android-1.0.5.apk',
      downloadUrl: 'https://example.com/apk',
    });
    expect(findMobileReleaseAsset(release, 'ios')).toEqual({
      name: 'Aura-Marketplace-iOS-1.0.5.ipa',
      downloadUrl: 'https://example.com/ipa',
    });
  });

  it('trusts only the Aura GitHub Releases download origin', () => {
    expect(isTrustedReleaseDownloadUrl(TRUSTED_APK_URL, 'mobile-v1.4.2')).toBe(true);
    expect(isTrustedReleaseDownloadUrl('https://evil.example/Aura/releases/download/mobile-v1.4.2/app.apk', 'mobile-v1.4.2')).toBe(false);
    expect(isTrustedReleaseDownloadUrl('https://github.com/MdSaifulIslamMSI/Aura/releases/download/mobile-v9.9.9/app.apk', 'mobile-v1.4.2')).toBe(false);
    expect(isTrustedReleaseDownloadUrl('http://github.com/MdSaifulIslamMSI/Aura/releases/download/mobile-v1.4.2/app.apk', 'mobile-v1.4.2')).toBe(false);
    expect(isTrustedReleaseDownloadUrl('', 'mobile-v1.4.2')).toBe(false);
  });

  it('keeps a trusted download URL and attaches the manifest digest', async () => {
    const fetchImpl = vi.fn((url) => {
      if (String(url).startsWith('https://api.github.com/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              draft: false,
              prerelease: false,
              tag_name: 'mobile-v1.4.2',
              name: 'Aura Mobile 1.4.2',
              html_url: 'https://github.com/MdSaifulIslamMSI/Aura/releases/tag/mobile-v1.4.2',
              assets: [
                { name: 'Aura-Marketplace-Android-1.4.2.apk', browser_download_url: TRUSTED_APK_URL },
                { name: 'Aura-Mobile-Release-Manifest-1.4.2.json', browser_download_url: TRUSTED_MANIFEST_URL },
              ],
            },
          ]),
        });
      }
      expect(String(url)).toBe(TRUSTED_MANIFEST_URL);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          assets: [
            { name: 'Aura-Marketplace-Android-1.4.2.apk', downloadUrl: TRUSTED_APK_URL, sha256: DIGEST },
          ],
        }),
      });
    });

    await expect(resolveLatestMobileRelease({ platform: 'android', fetchImpl })).resolves.toMatchObject({
      version: '1.4.2',
      tagName: 'mobile-v1.4.2',
      assetName: 'Aura-Marketplace-Android-1.4.2.apk',
      downloadUrl: TRUSTED_APK_URL,
      sha256: DIGEST,
    });
  });

  it('falls back to the release page when the asset URL is not a trusted origin', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        {
          draft: false,
          prerelease: false,
          tag_name: 'mobile-v1.4.2',
          html_url: 'https://github.com/MdSaifulIslamMSI/Aura/releases/tag/mobile-v1.4.2',
          assets: [
            { name: 'Aura-Marketplace-Android-1.4.2.apk', browser_download_url: 'https://github.com/apk' },
          ],
        },
      ]),
    });

    await expect(resolveLatestMobileRelease({ platform: 'android', fetchImpl })).resolves.toMatchObject({
      version: '1.4.2',
      downloadUrl: 'https://github.com/MdSaifulIslamMSI/Aura/releases/tag/mobile-v1.4.2',
      sha256: '',
    });
  });

  it('resolves without a digest when the manifest asset is missing', async () => {
    const fetchImpl = vi.fn((url) => {
      if (String(url).startsWith('https://api.github.com/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              draft: false,
              prerelease: false,
              tag_name: 'mobile-v1.4.2',
              html_url: 'https://github.com/MdSaifulIslamMSI/Aura/releases/tag/mobile-v1.4.2',
              assets: [
                { name: 'Aura-Marketplace-Android-1.4.2.apk', browser_download_url: TRUSTED_APK_URL },
              ],
            },
          ]),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await expect(resolveLatestMobileRelease({ platform: 'android', fetchImpl })).resolves.toMatchObject({
      downloadUrl: TRUSTED_APK_URL,
      sha256: '',
    });
  });
});
