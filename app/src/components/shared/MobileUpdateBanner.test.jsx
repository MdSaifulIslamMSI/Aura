import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntlProvider } from 'react-intl';
import MobileUpdateBanner from './MobileUpdateBanner';
import { resolveLatestMobileRelease } from '../../services/mobileReleaseChannel';
import { getNativeMobilePlatform, isCapacitorNativeRuntime } from '../../utils/nativeRuntime';

vi.mock('../../services/mobileReleaseChannel', () => ({
  compareMobileVersions: vi.fn((left = '', right = '') => {
    const parse = (value = '') => String(value).split('.').map((part) => Number.parseInt(part, 10) || 0);
    const [l, r] = [parse(left), parse(right)];
    for (let index = 0; index < 3; index += 1) {
      if ((l[index] || 0) > (r[index] || 0)) return 1;
      if ((l[index] || 0) < (r[index] || 0)) return -1;
    }
    return 0;
  }),
  resolveLatestMobileRelease: vi.fn(),
}));
vi.mock('../../utils/nativeRuntime', () => ({
  getNativeMobilePlatform: vi.fn(),
  isCapacitorNativeRuntime: vi.fn(),
}));
vi.mock('@capacitor/app', () => ({
  App: { getInfo: vi.fn() },
}));
import { App as CapacitorApp } from '@capacitor/app';

const TRUSTED_APK_URL = 'https://github.com/MdSaifulIslamMSI/Aura/releases/download/mobile-v1.4.2/Aura-Marketplace-Android-1.4.2.apk';
const DIGEST = 'a'.repeat(64);

const renderBanner = () => render(
  <IntlProvider locale="en" defaultLocale="en">
    <MobileUpdateBanner />
  </IntlProvider>
);

const mockNative = ({ platform = 'android', installedVersion = '1.3.0' } = {}) => {
  isCapacitorNativeRuntime.mockReturnValue(true);
  getNativeMobilePlatform.mockReturnValue(platform);
  CapacitorApp.getInfo.mockResolvedValue({ version: installedVersion });
};

describe('MobileUpdateBanner', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    // clearAllMocks keeps factory-provided implementations (the in-mock
    // compareMobileVersions) while resetting per-test call state;
    // restoreAllMocks would strip them and break later tests.
    vi.clearAllMocks();
    delete window.__auraTestStorageError;
  });

  it('renders nothing outside the native runtime', async () => {
    isCapacitorNativeRuntime.mockReturnValue(false);
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
    expect(resolveLatestMobileRelease).not.toHaveBeenCalled();
  });

  it('stays hidden when the installed version is unknown', async () => {
    mockNative({ installedVersion: '' });
    resolveLatestMobileRelease.mockResolvedValue({
      version: '1.4.2',
      tagName: 'mobile-v1.4.2',
      downloadUrl: TRUSTED_APK_URL,
      sha256: '',
    });
    const { container } = renderBanner();
    await waitFor(() => expect(resolveLatestMobileRelease).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden when the installed version matches the latest', async () => {
    mockNative({ installedVersion: '1.4.2' });
    resolveLatestMobileRelease.mockResolvedValue({
      version: '1.4.2',
      tagName: 'mobile-v1.4.2',
      downloadUrl: TRUSTED_APK_URL,
      sha256: '',
    });
    const { container } = renderBanner();
    await waitFor(() => expect(resolveLatestMobileRelease).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the update with a trusted download link and checksum for older installs', async () => {
    mockNative({ installedVersion: '1.3.0' });
    resolveLatestMobileRelease.mockResolvedValue({
      version: '1.4.2',
      tagName: 'mobile-v1.4.2',
      assetName: 'Aura-Marketplace-Android-1.4.2.apk',
      downloadUrl: TRUSTED_APK_URL,
      sha256: DIGEST,
    });
    renderBanner();
    expect(await screen.findByText('Aura Mobile 1.4.2 is ready')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Download Android update/ });
    expect(link).toHaveAttribute('href', TRUSTED_APK_URL);
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(screen.getByText(/Verify SHA-256/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${DIGEST.slice(0, 12)}…${DIGEST.slice(-12)}`))).toBeInTheDocument();
  });

  it('stores the dismissal per release tag', async () => {
    mockNative({ installedVersion: '1.3.0' });
    resolveLatestMobileRelease.mockResolvedValue({
      version: '1.4.2',
      tagName: 'mobile-v1.4.2',
      assetName: 'Aura-Marketplace-Android-1.4.2.apk',
      downloadUrl: TRUSTED_APK_URL,
      sha256: '',
    });
    renderBanner();
    const later = await screen.findByRole('button', { name: 'Later' });
    fireEvent.click(later);
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull();
    expect(window.localStorage.getItem('aura_mobile_update_dismissed_mobile-v1.4.2')).toBe('true');
  });
});
