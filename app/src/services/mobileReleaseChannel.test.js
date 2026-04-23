import { describe, expect, it, vi } from 'vitest';
import {
  compareMobileVersions,
  findMobileReleaseAsset,
  parseMobileVersion,
  resolveLatestMobileRelease,
} from './mobileReleaseChannel';

describe('mobileReleaseChannel', () => {
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

  it('resolves the newest mobile release from GitHub release data', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { draft: false, prerelease: false, tag_name: 'desktop-v1.0.0' },
        {
          draft: false,
          prerelease: false,
          tag_name: 'mobile-v1.4.2',
          name: 'Aura Mobile 1.4.2',
          html_url: 'https://github.com/releases/mobile-v1.4.2',
          assets: [
            {
              name: 'Aura-Marketplace-Android-1.4.2.apk',
              browser_download_url: 'https://github.com/apk',
            },
          ],
        },
      ]),
    });

    await expect(resolveLatestMobileRelease({ platform: 'android', fetchImpl })).resolves.toMatchObject({
      version: '1.4.2',
      tagName: 'mobile-v1.4.2',
      downloadUrl: 'https://github.com/apk',
    });
  });
});
