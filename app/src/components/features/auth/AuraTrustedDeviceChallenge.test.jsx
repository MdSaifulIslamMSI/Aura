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

    expect(screen.getByRole('radio', { name: /windows hello passkey/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /browser fallback key/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /browser fallback key/i }));

    const verifyButton = screen.getByRole('button', { name: /use browser fallback/i });
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
    await waitFor(() => {
      expect(refreshSession).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'user@example.com' }),
        { force: true, silent: true },
      );
    });
  });

  it('ignores duplicate trusted-device verify clicks while one proof is already running', async () => {
    const verifyDeviceChallenge = vi.fn().mockResolvedValue({ success: true });
    useAuth.mockReturnValue(buildAuthValue({ verifyDeviceChallenge }));

    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    renderWithRoute(<AuraTrustedDeviceChallenge />);

    const verifyButton = screen.getByRole('button', { name: /use windows hello passkey/i });
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

    fireEvent.click(screen.getByRole('button', { name: /register/i }));

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

    const verifyButton = screen.getByRole('button', { name: /register/i });
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

    const verifyButton = screen.getByRole('button', { name: /use windows hello passkey/i });
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

    expect(screen.queryByRole('radio', { name: /windows hello passkey/i })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /browser fallback key/i })).not.toBeDisabled();
    expect(screen.getAllByText(/fallback key already stored inside this browser/i).length).toBeGreaterThan(0);
  });

  it('moves focus into the blocking checkpoint and traps tab navigation', async () => {
    const beforeGateButton = document.createElement('button');
    beforeGateButton.type = 'button';
    beforeGateButton.textContent = 'Before gate';
    document.body.appendChild(beforeGateButton);
    beforeGateButton.focus();

    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    const view = renderWithRoute(<AuraTrustedDeviceChallenge />);

    const primaryAction = screen.getByRole('button', { name: /use windows hello passkey/i });
    await waitFor(() => {
      expect(primaryAction).toHaveFocus();
    });

    const selectedProofMethod = screen.getByRole('radio', { name: /windows hello passkey/i });
    const resetAction = screen.getByRole('button', { name: /reset this browser/i });
    resetAction.focus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(selectedProofMethod).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(resetAction).toHaveFocus();

    view.unmount();
    expect(beforeGateButton).toHaveFocus();
    beforeGateButton.remove();
  });

  it('lets keyboard users move between supported proof methods with arrow keys', async () => {
    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    renderWithRoute(<AuraTrustedDeviceChallenge />);

    const passkeyMethod = screen.getByRole('radio', { name: /windows hello passkey/i });
    const browserKeyMethod = screen.getByRole('radio', { name: /browser fallback key/i });

    expect(passkeyMethod).toHaveAttribute('aria-describedby', expect.stringContaining('trusted-device-blocking-webauthn-description'));
    expect(browserKeyMethod).toHaveAttribute('aria-describedby', expect.stringContaining('trusted-device-blocking-browser_key-description'));

    passkeyMethod.focus();
    fireEvent.keyDown(passkeyMethod, { key: 'ArrowRight' });

    expect(browserKeyMethod).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => {
      expect(browserKeyMethod).toHaveFocus();
    });

    const resetAction = screen.getByRole('button', { name: /reset this browser/i });
    fireEvent.keyDown(browserKeyMethod, { key: 'Tab', shiftKey: true });
    expect(resetAction).toHaveFocus();
  });

  it('keeps repeat public-route trusted-device checks minimized', async () => {
    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    renderWithRoute(<AuraTrustedDeviceChallenge />, '/');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /open trusted device checkpoint/i })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /privileged mode locked/i })).not.toBeInTheDocument();
    });

    expect(document.body).not.toHaveClass('aura-trusted-gate-open');

    const pageButton = document.createElement('button');
    pageButton.type = 'button';
    pageButton.textContent = 'Page action';
    document.body.appendChild(pageButton);
    pageButton.focus();

    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(tabEvent);

    expect(tabEvent.defaultPrevented).toBe(false);
    expect(pageButton).toHaveFocus();
    pageButton.remove();
  });

  it('opens first-time trusted-device enrollment even on public routes', async () => {
    useAuth.mockReturnValue(buildAuthValue({
      deviceChallenge: {
        token: 'challenge-token',
        mode: 'enroll',
        availableMethods: ['webauthn', 'browser_key'],
        preferredMethod: 'webauthn',
        registeredMethod: '',
        registeredLabel: '',
        challenge: 'challenge-value',
      },
    }));

    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    renderWithRoute(<AuraTrustedDeviceChallenge />, '/');

    expect(screen.getByRole('heading', { name: /finish trusted device setup/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /windows hello passkey/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open trusted device checkpoint/i })).not.toBeInTheDocument();
  });

  it('stays quiet when an earlier admin policy lock is active', async () => {
    const { default: AuraTrustedDeviceChallenge } = await loadComponent();
    renderWithRoute(<AuraTrustedDeviceChallenge disabled />);

    expect(screen.queryByRole('radio', { name: /windows hello passkey/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open trusted device checkpoint/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /privileged mode locked/i })).not.toBeInTheDocument();
  });
});
