import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { IntlProvider } from 'react-intl';
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
    audience: 'public',
    requiredAssurance: 'device_proof',
    blocking: true,
    availableMethods: ['webauthn', 'browser_key'],
    preferredMethod: 'webauthn',
    registeredMethod: 'webauthn',
    registeredLabel: 'Windows Mozilla',
    challenge: 'challenge-value',
  },
  refreshSession: vi.fn().mockResolvedValue(null),
  reauthenticateForSensitiveAction: vi.fn().mockResolvedValue(null),
  resetBrowserSession: vi.fn().mockResolvedValue({ redirectedTo: '/login' }),
  sessionIntelligence: {
    assurance: {
      isRecent: true,
    },
  },
  status: 'device_challenge_required',
  verifyDeviceChallenge: vi.fn().mockResolvedValue({ success: true }),
  ...overrides,
});

const loadComponent = async () => {
  vi.stubEnv('MODE', 'development');
  return import('./AuraTrustedDeviceChallenge.jsx');
};

const renderWithRoute = (ui, route = '/admin/dashboard') => render(
  <IntlProvider locale="en" messages={{}}>
    <MemoryRouter initialEntries={[route]}>
      {ui}
    </MemoryRouter>
  </IntlProvider>
);

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

  it('renders both offered proof options and verifies with the selected browser fallback key', async () => {
    const verifyDeviceChallenge = vi.fn().mockResolvedValue({ success: true });
    const refreshSession = vi.fn().mockResolvedValue(null);
    useAuth.mockReturnValue(buildAuthValue({ refreshSession, verifyDeviceChallenge }));

    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    renderWithRoute(<AuraTrustedDeviceChallenge />);

    fireEvent.click(screen.getByRole('button', { name: /try another way/i }));

    expect(screen.getByRole('radio', { name: /windows hello passkey/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /this browser/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /this browser/i }));

    const verifyButton = screen.getByRole('button', { name: /confirm this browser/i });
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
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('ignores duplicate trusted-device verify clicks while one proof is already running', async () => {
    const verifyDeviceChallenge = vi.fn().mockResolvedValue({ success: true });
    useAuth.mockReturnValue(buildAuthValue({ verifyDeviceChallenge }));

    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    renderWithRoute(<AuraTrustedDeviceChallenge />);

    const verifyButton = screen.getByRole('button', { name: /continue with device passkey/i });
    fireEvent.click(verifyButton);
    fireEvent.click(verifyButton);

    await waitFor(() => {
      expect(signTrustedDeviceChallenge).toHaveBeenCalledTimes(1);
    });
    expect(verifyDeviceChallenge).toHaveBeenCalledTimes(1);
  });

  it('reauthenticates from the enrollment click before signing the passkey challenge when sensitive auth is not explicitly fresh', async () => {
    const callOrder = [];
    const reauthenticateForSensitiveAction = vi.fn().mockImplementation(async () => {
      callOrder.push('reauth');
    });
    const verifyDeviceChallenge = vi.fn().mockImplementation(async () => {
      callOrder.push('verify');
      return { success: true };
    });
    signTrustedDeviceChallenge.mockImplementation(async () => {
      callOrder.push('sign');
      return {
        method: 'webauthn',
        credential: { id: 'credential-1' },
      };
    });
    useAuth.mockReturnValue(buildAuthValue({
      deviceChallenge: {
        token: 'challenge-token',
        mode: 'enroll',
        audience: 'public',
        requiredAssurance: 'device_proof',
        requiresRecentAuth: true,
        availableMethods: ['webauthn'],
        preferredMethod: 'webauthn',
        registeredMethod: '',
        registeredLabel: '',
        challenge: 'challenge-value',
      },
      reauthenticateForSensitiveAction,
      sessionIntelligence: {
        assurance: {
          isRecent: true,
        },
        posture: {
          session: {
            authAgeSeconds: 60,
            freshForSensitiveActions: false,
            stepUpActive: false,
          },
        },
      },
      verifyDeviceChallenge,
    }));

    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    renderWithRoute(<AuraTrustedDeviceChallenge />);

    fireEvent.click(screen.getByRole('button', { name: /register device passkey/i }));

    await waitFor(() => {
      expect(verifyDeviceChallenge).toHaveBeenCalledWith('challenge-token', expect.objectContaining({
        method: 'webauthn',
      }));
    });

    expect(reauthenticateForSensitiveAction).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['reauth', 'sign', 'verify']);
  });

  it.each([
    ['admin route', '/admin/dashboard'],
    ['public route', '/'],
  ])('prompts for password reauthentication before retrying passkey enrollment on the %s', async (_label, route) => {
    const passwordRequiredError = Object.assign(
      new Error('Enter your password to refresh this protected session, then retry this action.'),
      {
        code: 'auth/password-reauth-required',
        requiresPasswordReauth: true,
      },
    );
    const callOrder = [];
    const reauthenticateForSensitiveAction = vi.fn()
      .mockRejectedValueOnce(passwordRequiredError)
      .mockImplementationOnce(async () => {
        callOrder.push('reauth');
      });
    const verifyDeviceChallenge = vi.fn().mockImplementation(async () => {
      callOrder.push('verify');
      return { success: true };
    });
    signTrustedDeviceChallenge.mockImplementation(async () => {
      callOrder.push('sign');
      return {
        method: 'webauthn',
        credential: { id: 'credential-1' },
      };
    });
    useAuth.mockReturnValue(buildAuthValue({
      currentUser: {
        uid: 'firebase-user-1',
        email: 'user@example.com',
        providerData: [{ providerId: 'password' }],
      },
      deviceChallenge: {
        token: 'challenge-token',
        mode: 'enroll',
        audience: 'public',
        requiredAssurance: 'device_proof',
        requiresRecentAuth: true,
        availableMethods: ['webauthn'],
        preferredMethod: 'webauthn',
        registeredMethod: '',
        registeredLabel: '',
        challenge: 'challenge-value',
      },
      reauthenticateForSensitiveAction,
      sessionIntelligence: {
        assurance: {
          isRecent: false,
        },
        posture: {
          session: {
            authAgeSeconds: 1000,
            freshForSensitiveActions: false,
            stepUpActive: false,
          },
        },
      },
      verifyDeviceChallenge,
    }));

    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    renderWithRoute(<AuraTrustedDeviceChallenge />, route);

    const verifyButton = screen.getByRole('button', { name: /register device passkey/i });
    fireEvent.click(verifyButton);

    const passwordInput = await screen.findByLabelText(/account password/i);
    expect(signTrustedDeviceChallenge).not.toHaveBeenCalled();

    fireEvent.change(passwordInput, { target: { value: 'valid-password' } });
    fireEvent.click(verifyButton);

    await waitFor(() => {
      expect(verifyDeviceChallenge).toHaveBeenCalledWith('challenge-token', expect.objectContaining({
        method: 'webauthn',
      }));
    });

    expect(reauthenticateForSensitiveAction).toHaveBeenNthCalledWith(2, { password: 'valid-password' });
    expect(callOrder).toEqual(['reauth', 'sign', 'verify']);
  });

  it('shows a reset browser session fallback after repeated trusted-device failures', async () => {
    const resetBrowserSession = vi.fn().mockResolvedValue({ redirectedTo: '/login' });
    const verifyDeviceChallenge = vi.fn()
      .mockRejectedValueOnce(new Error('Recent re-authentication is required for this action.'))
      .mockRejectedValueOnce(new Error('Recent re-authentication is required for this action.'));
    useAuth.mockReturnValue(buildAuthValue({
      resetBrowserSession,
      verifyDeviceChallenge,
    }));

    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    renderWithRoute(<AuraTrustedDeviceChallenge />);

    const verifyButton = screen.getByRole('button', { name: /continue with device passkey/i });
    fireEvent.click(verifyButton);

    await waitFor(() => {
      expect(verifyDeviceChallenge).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('button', { name: /reset browser session/i })).not.toBeInTheDocument();

    fireEvent.click(verifyButton);

    const resetSessionButton = await screen.findByRole('button', { name: /reset browser session/i });
    fireEvent.click(resetSessionButton);

    await waitFor(() => {
      expect(resetBrowserSession).toHaveBeenCalledWith({ reason: 'trusted-device-challenge' });
    });
  });

  it('shows only the offered browser fallback method when passkey proof is unavailable', async () => {
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
    renderWithRoute(<AuraTrustedDeviceChallenge />);

    expect(screen.queryByRole('button', { name: /try another way/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm this browser/i })).toBeEnabled();
    expect(screen.getByText(/recognition key already stored in this browser/i)).toBeInTheDocument();
  });

  it('defaults desktop loopback challenges to the browser key instead of starting an incompatible passkey ceremony', async () => {
    getTrustedDeviceSupportProfile.mockReturnValue({
      ...baseSupportProfile,
      runtimeHost: 'localhost',
      webauthnHostEligible: false,
    });

    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    renderWithRoute(<AuraTrustedDeviceChallenge />);

    expect(screen.getByRole('button', { name: /confirm this browser/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /try another way/i }));
    expect(screen.getByRole('radio', { name: /windows hello passkey/i })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /this browser/i })).toBeEnabled();
  });

  it('moves focus into the blocking checkpoint and traps tab navigation', async () => {
    const beforeGateButton = document.createElement('button');
    beforeGateButton.type = 'button';
    beforeGateButton.textContent = 'Before gate';
    document.body.appendChild(beforeGateButton);
    beforeGateButton.focus();

    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    const view = renderWithRoute(<AuraTrustedDeviceChallenge />);

    const primaryAction = screen.getByRole('button', { name: /continue with device passkey/i });
    await waitFor(() => {
      expect(primaryAction).toHaveFocus();
    });

    const resetAction = screen.getByRole('button', { name: /reset this browser/i });
    const firstAction = screen.getByRole('button', { name: /try another way/i });
    resetAction.focus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(firstAction).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(resetAction).toHaveFocus();

    view.unmount();
    expect(beforeGateButton).toHaveFocus();
    beforeGateButton.remove();
  });

  it('lets keyboard users move between supported proof methods with arrow keys', async () => {
    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    renderWithRoute(<AuraTrustedDeviceChallenge />);

    fireEvent.click(screen.getByRole('button', { name: /try another way/i }));

    const passkeyMethod = screen.getByRole('radio', { name: /windows hello passkey/i });
    const browserKeyMethod = screen.getByRole('radio', { name: /this browser/i });

    expect(passkeyMethod).toHaveAttribute('aria-describedby', 'trusted-device-webauthn-description');
    expect(browserKeyMethod).toHaveAttribute('aria-describedby', 'trusted-device-browser_key-description');

    passkeyMethod.focus();
    fireEvent.keyDown(passkeyMethod, { key: 'ArrowRight' });

    expect(browserKeyMethod).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => {
      expect(browserKeyMethod).toHaveFocus();
    });

    expect(browserKeyMethod).toHaveFocus();
  });

  it('keeps a public authentication checkpoint visible and blocking on every route', async () => {
    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    renderWithRoute(<AuraTrustedDeviceChallenge />, '/');

    expect(screen.getByRole('heading', { name: /confirm this device/i })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(document.body).toHaveClass('aura-trusted-gate-open');
    expect(screen.queryByText(/admin access/i)).not.toBeInTheDocument();
  });

  it('uses the server audience contract rather than the pathname for admin language', async () => {
    useAuth.mockReturnValue(buildAuthValue({
      deviceChallenge: {
        token: 'challenge-token',
        mode: 'enroll',
        audience: 'admin',
        requiredAssurance: 'admin_passkey',
        blocking: true,
        availableMethods: ['webauthn', 'browser_key'],
        preferredMethod: 'webauthn',
        registeredMethod: '',
        registeredLabel: '',
        challenge: 'challenge-value',
      },
    }));

    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    renderWithRoute(<AuraTrustedDeviceChallenge />, '/');

    expect(screen.getByRole('heading', { name: /admin security check/i })).toBeInTheDocument();
    expect(screen.getByText(/browser-only recognition cannot unlock admin controls/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try another way/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/register this browser/i)).not.toBeInTheDocument();
  });

  it('stays quiet when an earlier admin policy lock is active', async () => {
    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    renderWithRoute(<AuraTrustedDeviceChallenge disabled />);

    expect(screen.queryByRole('button', { name: /continue with device passkey/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /confirm this device/i })).not.toBeInTheDocument();
  });
});
