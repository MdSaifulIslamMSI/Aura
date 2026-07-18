import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/context/AuthContext';
import AuthCheckpointLayer from './AuthCheckpointLayer';

vi.mock('./AuraTrustedDeviceChallenge', () => ({
  default: ({ onExit }) => (
    <div role="dialog" aria-label="Trusted device checkpoint">
      <p>Device verification controls</p>
      <button type="button" onClick={onExit}>Use another account</button>
    </div>
  ),
}));

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
};

const buildAuthValue = (overrides = {}) => ({
  status: 'authenticated',
  currentUser: { uid: 'user-1', email: 'buyer@example.com' },
  roles: { isAdmin: false },
  logout: vi.fn().mockResolvedValue(null),
  verifyDeviceChallenge: vi.fn().mockResolvedValue({ success: true }),
  verifyMfaTotpChallenge: vi.fn().mockResolvedValue({
    success: true,
    session: { sessionId: 'session-1' },
    profile: { id: 'profile-1' },
    roles: { isAdmin: false },
  }),
  verifyMfaPasskeyChallenge: vi.fn(),
  verifyMfaRecoveryCodeChallenge: vi.fn(),
  ...overrides,
});

const renderLayer = (authValue, route = '/') => render(
  <IntlProvider locale="en" messages={{}}>
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={[route]}>
        <AuthCheckpointLayer />
        <LocationProbe />
      </MemoryRouter>
    </AuthContext.Provider>
  </IntlProvider>
);

describe('AuthCheckpointLayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the actionable device checkpoint globally on the login route', () => {
    renderLayer(buildAuthValue({
      status: 'device_challenge_required',
      deviceChallenge: {
        token: 'device-challenge-1',
        mode: 'assert',
        audience: 'public',
        surface: 'login',
        purpose: 'login',
        requiredAssurance: 'device_recognition',
        availableMethods: ['browser_key'],
        preferredMethod: 'browser_key',
      },
    }), '/login');

    expect(screen.getByRole('dialog', { name: /trusted device checkpoint/i })).toBeInTheDocument();
    expect(screen.getByText(/device verification controls/i)).toBeInTheDocument();
  });

  it('does not turn checkout MFA into admin copy merely because the account has an admin role', () => {
    renderLayer(buildAuthValue({
      status: 'mfa_challenge_required',
      roles: { isAdmin: true },
      mfaChallenge: {
        challengeId: 'checkout-mfa-1',
        audience: 'public',
        surface: 'checkout',
        purpose: 'step_up',
        action: 'checkout_payment',
        allowedMethods: ['totp'],
        preferredMethod: 'totp',
      },
      mfaPolicy: {
        audience: 'public',
        reason: 'admin_policy',
        allowedMethods: ['totp'],
      },
    }), '/checkout');

    expect(screen.getByRole('dialog')).toHaveAttribute('data-checkpoint-audience', 'public');
    expect(screen.getByRole('heading', { name: /confirm it's you/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /admin verification required/i })).not.toBeInTheDocument();
  });

  it('uses explicit admin challenge metadata even when the URL is login', () => {
    renderLayer(buildAuthValue({
      status: 'mfa_challenge_required',
      mfaChallenge: {
        challengeId: 'admin-mfa-1',
        audience: 'admin',
        surface: 'admin',
        purpose: 'step_up',
        action: 'admin_user_update',
        requiredStrength: 'passkey',
        allowedMethods: ['passkey'],
        preferredMethod: 'passkey',
      },
      mfaPolicy: { audience: 'admin', allowedMethods: ['passkey'] },
    }), '/login');

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-checkpoint-audience', 'admin');
    expect(screen.getByRole('heading', { name: /admin verification required/i })).toBeInTheDocument();
  });

  it('keeps reverse-tab focus inside the MFA checkpoint from its initially focused heading', () => {
    renderLayer(buildAuthValue({
      status: 'mfa_challenge_required',
      mfaChallenge: {
        challengeId: 'mfa-focus-trap',
        audience: 'public',
        allowedMethods: ['totp'],
        preferredMethod: 'totp',
      },
      mfaPolicy: { audience: 'public', allowedMethods: ['totp'] },
    }), '/login');

    const heading = screen.getByRole('heading', { name: /confirm it's you/i });
    heading.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

    expect(screen.getByRole('button', { name: /return to storefront/i })).toHaveFocus();
  });

  it('signs out before navigating the safe exit to the storefront', async () => {
    let finishLogout;
    const logout = vi.fn().mockImplementation(() => new Promise((resolve) => {
      finishLogout = resolve;
    }));

    renderLayer(buildAuthValue({
      status: 'device_challenge_required',
      logout,
      deviceChallenge: {
        token: 'device-challenge-exit',
        mode: 'assert',
        audience: 'public',
        requiredAssurance: 'device_recognition',
        availableMethods: ['browser_key'],
        preferredMethod: 'browser_key',
      },
    }), '/login');

    fireEvent.click(screen.getByRole('button', { name: /use another account/i }));

    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/login');

    finishLogout();
    await waitFor(() => {
      expect(screen.getByTestId('location-probe')).toHaveTextContent('/');
    });
  });

  it('fails closed when the checkpoint has no logout handler', async () => {
    renderLayer(buildAuthValue({
      status: 'device_challenge_required',
      logout: undefined,
      deviceChallenge: {
        token: 'device-challenge-no-logout',
        mode: 'assert',
        audience: 'public',
        requiredAssurance: 'device_recognition',
        availableMethods: ['browser_key'],
        preferredMethod: 'browser_key',
      },
    }), '/login');

    fireEvent.click(screen.getByRole('button', { name: /use another account/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not finish signing out/i);
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/login');
  });
});
