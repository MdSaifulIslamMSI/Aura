import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../../../context/AuthContext';
import {
  getTrustedDeviceSupportProfile,
  resetTrustedDeviceIdentity,
  signTrustedDeviceChallenge,
} from '../../../services/deviceTrustClient';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../services/deviceTrustClient', () => ({
  getTrustedDeviceSupportProfile: vi.fn(),
  resetTrustedDeviceIdentity: vi.fn(),
  signTrustedDeviceChallenge: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const baseSupportProfile = {
  webauthn: true,
  browserKeyFallback: true,
  biometricPasskeyLabel: 'Windows Hello passkey',
  runtimeHost: 'aurapilot.vercel.app',
  webauthnHostEligible: true,
  localIpHost: false,
};

const buildAuthValue = (overrides = {}) => ({
  currentUser: { uid: 'firebase-user-1', email: 'user@example.com' },
  deviceChallenge: {
    token: 'challenge-token',
    mode: 'assert',
    availableMethods: ['webauthn', 'browser_key'],
    preferredMethod: 'webauthn',
    registeredMethod: 'webauthn',
    registeredLabel: 'Windows Mozilla',
    challenge: 'challenge-value',
  },
  refreshSession: vi.fn().mockResolvedValue(null),
  status: 'device_challenge_required',
  verifyDeviceChallenge: vi.fn().mockResolvedValue({ success: true }),
  ...overrides,
});

const loadComponent = async () => {
  vi.stubEnv('MODE', 'development');
  return import('./AuraTrustedDeviceChallenge.jsx');
};

describe('AuraTrustedDeviceChallenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTrustedDeviceSupportProfile.mockReturnValue(baseSupportProfile);
    resetTrustedDeviceIdentity.mockResolvedValue(undefined);
    signTrustedDeviceChallenge.mockResolvedValue({
      method: 'browser_key',
      proofBase64: 'proof-data',
      publicKeySpkiBase64: '',
    });
    useAuth.mockReturnValue(buildAuthValue());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders both proof options and verifies with the selected RSA-PSS browser key', async () => {
    const verifyDeviceChallenge = vi.fn().mockResolvedValue({ success: true });
    useAuth.mockReturnValue(buildAuthValue({ verifyDeviceChallenge }));

    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    render(<AuraTrustedDeviceChallenge />);

    expect(screen.getByRole('radio', { name: /windows hello passkey/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /rsa-pss browser key/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /rsa-pss browser key/i }));

    const verifyButton = screen.getByRole('button', { name: /verify browser/i });
    fireEvent.click(verifyButton);

    await waitFor(() => {
      expect(signTrustedDeviceChallenge).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'challenge-token' }),
        { preferredMethod: 'browser_key' },
      );
    });

    expect(verifyDeviceChallenge).toHaveBeenCalledWith('challenge-token', expect.objectContaining({
      method: 'browser_key',
    }));
  });

  it('keeps both proof cards visible even when only the browser-key method is currently offered', async () => {
    useAuth.mockReturnValue(buildAuthValue({
      deviceChallenge: {
        token: 'challenge-token',
        mode: 'assert',
        availableMethods: ['browser_key'],
        preferredMethod: 'browser_key',
        registeredMethod: 'browser_key',
        registeredLabel: 'Windows Mozilla',
        challenge: 'challenge-value',
      },
    }));

    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    render(<AuraTrustedDeviceChallenge />);

    expect(screen.getByRole('radio', { name: /windows hello passkey/i })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /rsa-pss browser key/i })).not.toBeDisabled();
    expect(screen.getByText(/currently registered with an rsa-pss browser key, not a passkey/i)).toBeInTheDocument();
  });
});
