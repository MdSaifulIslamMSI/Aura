import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
import { MarketProvider } from '@/context/MarketContext';
import { useLoginController } from './useLoginController';

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
});
