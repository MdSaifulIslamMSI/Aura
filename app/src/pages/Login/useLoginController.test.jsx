import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
import { MarketProvider } from '@/context/MarketContext';
import { useLoginController } from './useLoginController';

const { getFirebaseSocialAuthStatusMock } = vi.hoisted(() => ({
  getFirebaseSocialAuthStatusMock: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({
  getFirebaseSocialAuthStatus: getFirebaseSocialAuthStatusMock,
}));

const LocationProbe = () => {
  const location = useLocation();
  return (
    <pre data-testid="location-probe">
      {JSON.stringify({
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
        state: location.state || null,
      })}
    </pre>
  );
};

const LoginControllerProbe = () => {
  useLoginController();
  return <div>Login Screen</div>;
};

const SocialSignInProbe = () => {
  const { authError, handleSocialSignIn, signInWithGoogle } = useLoginController();
  const [result, setResult] = React.useState('idle');

  React.useEffect(() => {
    handleSocialSignIn(signInWithGoogle, 'Google')
      .then(() => setResult('completed'))
      .catch((error) => setResult(error?.message || 'failed'));
  }, [handleSocialSignIn, signInWithGoogle]);

  return (
    <>
      <div data-testid="social-result">{result}</div>
      <div data-testid="social-error-title">{authError?.title || 'none'}</div>
      <div data-testid="social-error-detail">{authError?.detail || 'none'}</div>
      <div data-testid="social-error-hint">{authError?.hint || 'none'}</div>
    </>
  );
};

const buildAuthValue = (overrides = {}) => ({
  currentUser: null,
  isAuthenticated: false,
  loading: false,
  login: vi.fn(),
  loginWithPhoneCredential: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
  signInWithFacebook: vi.fn(),
  signInWithGoogle: vi.fn(),
  signInWithX: vi.fn(),
  signup: vi.fn(),
  syncUserWithBackend: vi.fn(),
  ...overrides,
});

const renderLoginController = (authValue, initialEntry) => render(
  <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
    <AuthContext.Provider value={buildAuthValue(authValue)}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <Routes>
          <Route path="/login" element={<LoginControllerProbe />} />
          <Route path="/checkout" element={<div>Checkout Screen</div>} />
          <Route path="/profile" element={<div>Profile Screen</div>} />
          <Route path="/" element={<div>Home Screen</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  </MarketProvider>
);

describe('useLoginController', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    getFirebaseSocialAuthStatusMock.mockReturnValue({
      ready: true,
      supported: true,
      runtimeHost: 'localhost',
      runtimeBlocked: false,
      redirectPreferred: false,
      runtimeIpHost: false,
      disabledByConfig: false,
      initErrorCode: '',
      initErrorMessage: '',
    });
  });

  it('redirects already-authenticated visitors only after bootstrap settles', async () => {
    const initialEntry = {
      pathname: '/login',
      state: {
        from: {
          pathname: '/checkout',
          search: '?coupon=save10',
          hash: '#summary',
        },
      },
    };

    const view = renderLoginController({
      currentUser: { uid: 'user-1', email: 'member@example.com' },
      isAuthenticated: true,
      loading: true,
    }, initialEntry);

    expect(screen.getByText('Login Screen')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/login"');

    view.rerender(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({
          currentUser: { uid: 'user-1', email: 'member@example.com' },
          isAuthenticated: true,
          loading: false,
        })}>
          <MemoryRouter initialEntries={[initialEntry]}>
            <LocationProbe />
            <Routes>
              <Route path="/login" element={<LoginControllerProbe />} />
              <Route path="/checkout" element={<div>Checkout Screen</div>} />
              <Route path="/profile" element={<div>Profile Screen</div>} />
              <Route path="/" element={<div>Home Screen</div>} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Checkout Screen')).toBeInTheDocument();
      expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/checkout"');
      expect(screen.getByTestId('location-probe')).toHaveTextContent('"search":"?coupon=save10"');
      expect(screen.getByTestId('location-probe')).toHaveTextContent('"hash":"#summary"');
    });
  });

  it('does not auto-redirect when auth resolves after the login page has already settled', async () => {
    const initialEntry = {
      pathname: '/login',
      state: {
        from: {
          pathname: '/profile',
          search: '',
          hash: '',
        },
      },
    };

    const view = renderLoginController({
      currentUser: null,
      isAuthenticated: false,
      loading: false,
    }, initialEntry);

    expect(screen.getByText('Login Screen')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/login"');

    view.rerender(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({
          currentUser: { uid: 'user-2', email: 'fresh@example.com' },
          isAuthenticated: false,
          loading: true,
        })}>
          <MemoryRouter initialEntries={[initialEntry]}>
            <LocationProbe />
            <Routes>
              <Route path="/login" element={<LoginControllerProbe />} />
              <Route path="/checkout" element={<div>Checkout Screen</div>} />
              <Route path="/profile" element={<div>Profile Screen</div>} />
              <Route path="/" element={<div>Home Screen</div>} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    view.rerender(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({
          currentUser: { uid: 'user-2', email: 'fresh@example.com' },
          isAuthenticated: true,
          loading: false,
        })}>
          <MemoryRouter initialEntries={[initialEntry]}>
            <LocationProbe />
            <Routes>
              <Route path="/login" element={<LoginControllerProbe />} />
              <Route path="/checkout" element={<div>Checkout Screen</div>} />
              <Route path="/profile" element={<div>Profile Screen</div>} />
              <Route path="/" element={<div>Home Screen</div>} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Login Screen')).toBeInTheDocument();
      expect(screen.queryByText('Profile Screen')).not.toBeInTheDocument();
      expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/login"');
    });
  });

  it('keeps popup-close as a cancellation message on safe hosts', async () => {
    const signInWithGoogle = vi.fn().mockRejectedValue(Object.assign(
      new Error('Google sign-in was cancelled before completion.'),
      { code: 'auth/popup-closed-by-user' },
    ));

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({ signInWithGoogle })}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<SocialSignInProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('social-error-title')).toHaveTextContent('Sign-In Cancelled');
      expect(screen.getByTestId('social-error-detail')).toHaveTextContent('The social sign-in window was closed before completing.');
    });

    expect(signInWithGoogle).toHaveBeenCalled();
  });

  it('shows a recoverable session-sync message when social auth succeeds but backend sync returns a masked 500', async () => {
    const signInWithGoogle = vi.fn().mockRejectedValue(Object.assign(
      new Error('Something went wrong!'),
      {
        status: 500,
        url: '/api/auth/sync',
        serverRequestId: 'req-social-sync-2',
      },
    ));

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({ signInWithGoogle })}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<SocialSignInProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('social-error-title')).toHaveTextContent('Google Sign-In Needs Retry');
      expect(screen.getByTestId('social-error-detail')).toHaveTextContent('could not finish opening your marketplace session');
      expect(screen.getByTestId('social-error-hint')).toHaveTextContent('req-social-sync-2');
    });

    expect(signInWithGoogle).toHaveBeenCalled();
  });

  it('lets risky hosts complete the redirect handoff without surfacing a popup cancellation', async () => {
    getFirebaseSocialAuthStatusMock.mockReturnValue({
      ready: true,
      supported: true,
      runtimeHost: '127.0.0.1',
      runtimeBlocked: false,
      redirectPreferred: true,
      runtimeIpHost: true,
      disabledByConfig: false,
      initErrorCode: '',
      initErrorMessage: '',
    });

    const signInWithGoogle = vi.fn().mockResolvedValue({ redirecting: true });

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({ signInWithGoogle })}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<SocialSignInProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('social-result')).toHaveTextContent('completed');
      expect(screen.getByTestId('social-error-title')).toHaveTextContent('none');
    });

    expect(signInWithGoogle).toHaveBeenCalled();
  });
});
