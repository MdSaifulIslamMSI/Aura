import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
import { MarketProvider } from '@/context/MarketContext';
import { authApi, otpApi } from '@/services/api';
import {
  buildDesktopAuthCancelUrl,
  buildDesktopDuoReturnTo,
  normalizeDesktopAuthCallbackUrl,
  persistDesktopBrowserHandoff,
  resolveDesktopBrowserHandoff,
  useLoginController,
} from './useLoginController';

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

const DesktopBrowserHandoffProbe = () => {
  const {
    authError,
    authSuccess,
    desktopBrowserConsentActionLabel,
    desktopBrowserConsentReady,
    desktopBrowserConsentIdentity,
    desktopBrowserConsentSubmitting,
    desktopBrowserHandoffCheckpoint,
    desktopBrowserHandoffPreflightFailed,
    desktopBrowserSessionHydrating,
    handleDesktopBrowserConsent,
    handleDesktopBrowserConsentCancel,
    handleDesktopBrowserDeviceChallenge,
    handleDesktopBrowserMfaPasskey,
    handleDesktopBrowserMfaTotp,
  } = useLoginController();

  return (
    <>
      <button type="button" onClick={handleDesktopBrowserConsent}>Continue desktop handoff</button>
      <button type="button" onClick={handleDesktopBrowserConsentCancel}>Cancel desktop handoff</button>
      <button
        type="button"
        onClick={() => {
          void handleDesktopBrowserDeviceChallenge('browser-device-challenge', {
            method: 'browser_key',
            proofBase64: 'browser-device-proof',
          }).catch(() => {});
        }}
      >
        Verify browser device
      </button>
      <button
        type="button"
        onClick={() => {
          void handleDesktopBrowserMfaPasskey({ challengeId: 'desktop-mfa-challenge' }).catch(() => {});
        }}
      >
        Verify browser passkey
      </button>
      <button
        type="button"
        onClick={() => {
          void handleDesktopBrowserMfaTotp({ challengeId: 'desktop-mfa-challenge', code: '123456' }).catch(() => {});
        }}
      >
        Verify browser TOTP
      </button>
      <div data-testid="desktop-consent-ready">{String(desktopBrowserConsentReady)}</div>
      <div data-testid="desktop-consent-identity">{desktopBrowserConsentIdentity}</div>
      <div data-testid="desktop-consent-submitting">{String(desktopBrowserConsentSubmitting)}</div>
      <div data-testid="desktop-session-hydrating">{String(desktopBrowserSessionHydrating)}</div>
      <div data-testid="desktop-consent-action-label">{desktopBrowserConsentActionLabel}</div>
      <div data-testid="desktop-consent-error">{authError?.detail || 'none'}</div>
      <div data-testid="desktop-consent-success">{authSuccess?.title || 'none'}</div>
      <div data-testid="desktop-preflight-status">{desktopBrowserHandoffCheckpoint?.status || 'none'}</div>
      <div data-testid="desktop-preflight-failed">{String(desktopBrowserHandoffPreflightFailed)}</div>
    </>
  );
};

const DesktopBrowserHandoffNavigationProbe = ({ nextRequestId }) => {
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        onClick={() => navigate(
          `/desktop-login?desktopAuthRequest=${nextRequestId}#desktopAuthSecret=secret-next-request&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthTransport=form_post`
        )}
      >
        Start next desktop request
      </button>
      <DesktopBrowserHandoffProbe />
    </>
  );
};

const DesktopBrowserHandoffRoundTripProbe = ({ firstRequestId, nextRequestId }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const navigateToRequest = (requestId, secret) => navigate(
    `/desktop-login?desktopAuthRequest=${requestId}#desktopAuthSecret=${secret}&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthTransport=form_post`
  );

  return (
    <>
      <button type="button" onClick={() => navigateToRequest(nextRequestId, 'secret-roundtrip-next')}>
        Start roundtrip next request
      </button>
      <button type="button" onClick={() => navigateToRequest(firstRequestId, 'secret-roundtrip-first')}>
        Reopen roundtrip first request
      </button>
      <div data-testid="desktop-roundtrip-location">{location.search}</div>
      <DesktopBrowserHandoffProbe />
    </>
  );
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

const MicrosoftSignInProbe = () => {
  const { authError, handleSocialSignIn, signInWithMicrosoft } = useLoginController();
  const [result, setResult] = React.useState('idle');

  React.useEffect(() => {
    handleSocialSignIn(signInWithMicrosoft, 'Microsoft')
      .then(() => setResult('completed'))
      .catch((error) => setResult(error?.message || 'failed'));
  }, [handleSocialSignIn, signInWithMicrosoft]);

  return (
    <>
      <div data-testid="social-result">{result}</div>
      <div data-testid="social-error-title">{authError?.title || 'none'}</div>
      <div data-testid="social-error-detail">{authError?.detail || 'none'}</div>
      <div data-testid="social-error-hint">{authError?.hint || 'none'}</div>
    </>
  );
};

const DesktopBrowserSignInProbe = () => {
  const {
    authSuccess,
    canUseDesktopBrowserSignIn,
    canUseDesktopOwnerAccessSignIn,
    handleDesktopBrowserSignIn,
    handleDesktopOwnerAccessSignIn,
  } = useLoginController();
  const [result, setResult] = React.useState('idle');
  const [ownerResult, setOwnerResult] = React.useState('idle');
  const startedRef = React.useRef(false);
  const ownerStartedRef = React.useRef(false);

  React.useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    handleDesktopBrowserSignIn()
      .then(() => setResult('completed'))
      .catch((error) => setResult(error?.message || 'failed'));
  }, [handleDesktopBrowserSignIn]);

  React.useEffect(() => {
    if (!canUseDesktopOwnerAccessSignIn || ownerStartedRef.current) return;
    ownerStartedRef.current = true;
    handleDesktopOwnerAccessSignIn()
      .then(() => setOwnerResult('completed'))
      .catch((error) => setOwnerResult(error?.message || 'failed'));
  }, [canUseDesktopOwnerAccessSignIn, handleDesktopOwnerAccessSignIn]);

  return (
    <>
      <div data-testid="desktop-browser-supported">{String(canUseDesktopBrowserSignIn)}</div>
      <div data-testid="desktop-browser-result">{result}</div>
      <div data-testid="desktop-browser-success-title">{authSuccess?.title || 'none'}</div>
      <div data-testid="desktop-owner-access-supported">{String(canUseDesktopOwnerAccessSignIn)}</div>
      <div data-testid="desktop-owner-access-result">{ownerResult}</div>
    </>
  );
};

const DesktopBrowserCancelProbe = () => {
  const {
    authError,
    desktopBrowserSignInPending,
    handleCancelDesktopBrowserSignIn,
    handleDesktopBrowserSignIn,
    handleReopenDesktopBrowserSignIn,
  } = useLoginController();

  return (
    <>
      <button type="button" onClick={handleDesktopBrowserSignIn}>Start browser</button>
      <button type="button" onClick={handleReopenDesktopBrowserSignIn}>Reopen browser</button>
      <button type="button" onClick={handleCancelDesktopBrowserSignIn}>Cancel browser</button>
      <div data-testid="desktop-browser-pending">{String(desktopBrowserSignInPending)}</div>
      <div data-testid="desktop-browser-cancel-title">{authError?.title || 'none'}</div>
    </>
  );
};

const DesktopAdminSignInProbe = () => {
  const {
    canUseDesktopBrowserSignIn,
    handleDesktopAdminSignIn,
  } = useLoginController();

  return (
    <>
      <button type="button" onClick={handleDesktopAdminSignIn}>Start admin sign-in</button>
      <div data-testid="desktop-admin-supported">{String(canUseDesktopBrowserSignIn)}</div>
    </>
  );
};

const DesktopOwnerAccessFailureProbe = () => {
  const {
    authError,
    authSuccess,
    canUseDesktopOwnerAccessSignIn,
    handleDesktopOwnerAccessSignIn,
  } = useLoginController();
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    if (!canUseDesktopOwnerAccessSignIn || startedRef.current) return;
    startedRef.current = true;
    handleDesktopOwnerAccessSignIn();
  }, [canUseDesktopOwnerAccessSignIn, handleDesktopOwnerAccessSignIn]);

  return (
    <>
      <div data-testid="desktop-owner-error-detail">{authError?.detail || 'none'}</div>
      <div data-testid="desktop-owner-success-title">{authSuccess?.title || 'none'}</div>
    </>
  );
};

const DuoLoginFlagProbe = () => {
  const { isDuoLoginEnabled } = useLoginController();
  return <div data-testid="duo-login-enabled">{String(isDuoLoginEnabled)}</div>;
};

const DuoLoginStartProbe = () => {
  const { handleDuoSignIn } = useLoginController();
  const [result, setResult] = React.useState('idle');
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    handleDuoSignIn()
      .then(() => setResult('completed'))
      .catch((error) => setResult(error?.message || 'failed'));
  }, [handleDuoSignIn]);

  return <div data-testid="duo-start-result">{result}</div>;
};

const DuoLoginStartWithEmailProbe = () => {
  const { formData, handleChange, handleDuoSignIn } = useLoginController();
  const [result, setResult] = React.useState('idle');

  return (
    <>
      <input aria-label="Email" name="email" value={formData.email} onChange={handleChange} />
      <button
        type="button"
        onClick={() => {
          handleDuoSignIn()
            .then(() => setResult('completed'))
            .catch((error) => setResult(error?.message || 'failed'));
        }}
      >
        start duo
      </button>
      <div data-testid="duo-start-result">{result}</div>
    </>
  );
};

const ResetPasswordFailureProbe = () => {
  const {
    authError,
    formData,
    handleChange,
    handleOtpChange,
    handlePhoneChange,
    handleSubmit,
    mode,
    otpValues,
    step,
    switchMode,
  } = useLoginController();

  return (
    <form onSubmit={handleSubmit}>
      <div data-testid="reset-mode">{mode}</div>
      <div data-testid="reset-step">{step}</div>
      <div data-testid="reset-error-title">{authError?.title || 'none'}</div>
      <div data-testid="reset-error-hint">{authError?.hint || 'none'}</div>
      <button type="button" onClick={() => switchMode('forgot-password')}>forgot</button>
      <input aria-label="Email" name="email" value={formData.email} onChange={handleChange} />
      <input aria-label="Phone Number" value={formData.phone} onChange={handlePhoneChange} />
      <input aria-label="Password" name="password" value={formData.password} onChange={handleChange} />
      <input aria-label="Confirm Password" name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} />
      {otpValues.map((value, index) => (
        <input
          aria-label={`OTP digit ${index + 1}`}
          key={index}
          value={value}
          onChange={(event) => handleOtpChange(index, event.target.value)}
        />
      ))}
      <button type="submit">submit</button>
      <button
        type="button"
        onClick={() => {
          const event = { preventDefault: vi.fn() };
          handleSubmit(event);
          handleSubmit(event);
        }}
      >
        double-submit
      </button>
    </form>
  );
};

const PhoneCountryProbe = () => {
  const {
    formData,
    handlePhoneChange,
    handlePhoneCountryChange,
    phoneCountryCode,
    phoneLocalValue,
  } = useLoginController();

  return (
    <>
      <select aria-label="Country calling code" value={phoneCountryCode} onChange={handlePhoneCountryChange}>
        <option value="IN">India</option>
        <option value="GB">United Kingdom</option>
        <option value="US">United States</option>
      </select>
      <input aria-label="Phone Number" value={phoneLocalValue} onChange={handlePhoneChange} />
      <div data-testid="phone-country">{phoneCountryCode}</div>
      <div data-testid="phone-local">{phoneLocalValue}</div>
      <div data-testid="phone-full">{formData.phone}</div>
    </>
  );
};

const SecureSignalsProbe = () => {
  const { secureSignals } = useLoginController();
  const socialSignal = secureSignals.find((signal) => signal.label === 'Social access');
  return <div data-testid="social-access-signal">{socialSignal?.value || ''}</div>;
};

const buildAuthValue = (overrides = {}) => ({
  currentUser: null,
  isAuthenticated: false,
  loading: false,
  roles: { isAdmin: false, isSeller: false, isVerified: false },
  session: { deviceMethod: 'browser_key', webAuthnStepUpActive: false },
  status: 'signed_out',
  login: vi.fn(),
  loginWithPhoneCredential: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
  signInWithFacebook: vi.fn(),
  signInWithGitHub: vi.fn(),
  signInWithGoogle: vi.fn(),
  signInWithMicrosoft: vi.fn(),
  signInWithApple: vi.fn(),
  signInWithX: vi.fn(),
  signInWithDesktopBrowser: vi.fn(),
  reopenDesktopBrowserSignIn: vi.fn(),
  registerMfaPasskey: vi.fn(),
  signInWithDesktopOwnerAccess: vi.fn(),
  signup: vi.fn(),
  syncUserWithBackend: vi.fn(),
  verifyMfaPasskeyChallenge: vi.fn(),
  ...overrides,
});

const buildDesktopCookieSessionPayload = ({
  email = 'duo@example.com',
  isAdmin = false,
  deviceMethod = 'browser_key',
  webAuthnStepUpActive = false,
} = {}) => ({
  status: 'authenticated',
  session: {
    email,
    deviceMethod,
    webAuthnStepUpActive,
  },
  profile: { email, isAdmin },
  roles: { isAdmin, isSeller: false, isVerified: true },
});

const AuthenticationCheckpointProbe = ({ completeAuthentication }) => {
  const {
    authSuccess,
    handleSocialSignIn,
    isSessionCheckpointPending,
    sessionStatus,
    signInWithGoogle,
  } = useLoginController();

  return (
    <>
      <button type="button" onClick={() => handleSocialSignIn(signInWithGoogle, 'Google')}>start sign-in</button>
      <button type="button" onClick={completeAuthentication}>complete checkpoint</button>
      <div data-testid="checkpoint-pending">{String(isSessionCheckpointPending)}</div>
      <div data-testid="checkpoint-status">{sessionStatus || 'none'}</div>
      <div data-testid="checkpoint-success">{authSuccess?.title || 'none'}</div>
    </>
  );
};

const AuthenticationCheckpointHarness = ({ checkpointStatus }) => {
  const [authState, setAuthState] = React.useState({
    currentUser: null,
    isAuthenticated: false,
    loading: false,
    status: 'signed_out',
  });
  const signInWithGoogle = React.useCallback(async () => {
    setAuthState({
      currentUser: { uid: 'checkpoint-user', email: 'checkpoint@example.com' },
      isAuthenticated: false,
      loading: false,
      status: checkpointStatus,
    });
    return { dbUser: { email: 'checkpoint@example.com' } };
  }, [checkpointStatus]);
  const completeAuthentication = React.useCallback(() => {
    setAuthState((current) => ({
      ...current,
      isAuthenticated: true,
      status: 'authenticated',
    }));
  }, []);

  return (
    <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
      <AuthContext.Provider value={buildAuthValue({ ...authState, signInWithGoogle })}>
        <MemoryRouter initialEntries={[{
          pathname: '/login',
          state: { from: { pathname: '/profile' } },
        }]}
        >
          <LocationProbe />
          <Routes>
            <Route path="/login" element={<AuthenticationCheckpointProbe completeAuthentication={completeAuthentication} />} />
            <Route path="/profile" element={<div>Profile Screen</div>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </MarketProvider>
  );
};

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
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    delete window.auraDesktop;
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
      runtimeElectronDesktop: false,
    });
    vi.spyOn(authApi, 'prepareDesktopHandoff').mockResolvedValue({
      status: 'handoff_ready',
      handoffReady: true,
    });
  });

  it('accepts only loopback desktop callback urls for hosted handoff', () => {
    expect(normalizeDesktopAuthCallbackUrl('http://localhost:47831/desktop-auth/complete?x=1#frag'))
      .toBe('http://127.0.0.1:47831/desktop-auth/complete');
    expect(normalizeDesktopAuthCallbackUrl('http://127.0.0.1:47831/desktop-auth/complete'))
      .toBe('http://127.0.0.1:47831/desktop-auth/complete');
    expect(normalizeDesktopAuthCallbackUrl('http://[::1]:47831/desktop-auth/complete'))
      .toBe('http://127.0.0.1:47831/desktop-auth/complete');
    expect(normalizeDesktopAuthCallbackUrl('http://localhost:47841/desktop-auth/complete'))
      .toBe('http://127.0.0.1:47841/desktop-auth/complete');
    expect(normalizeDesktopAuthCallbackUrl('/desktop-auth/complete')).toBe('/desktop-auth/complete');
    expect(normalizeDesktopAuthCallbackUrl('')).toBe('');
    expect(normalizeDesktopAuthCallbackUrl('https://localhost:47831/desktop-auth/complete')).toBe('');
    expect(normalizeDesktopAuthCallbackUrl('http://localhost:47842/desktop-auth/complete')).toBe('');
    expect(normalizeDesktopAuthCallbackUrl('https://evil.example.test/desktop-auth/complete')).toBe('');
  });

  it('derives cancellation only from a trusted loopback desktop callback', () => {
    expect(buildDesktopAuthCancelUrl('http://localhost:47831/desktop-auth/complete?ignored=1#ignored'))
      .toBe('http://127.0.0.1:47831/desktop-auth/cancel');
    expect(buildDesktopAuthCancelUrl('/desktop-auth/complete')).toBe('/desktop-auth/cancel');
    expect(buildDesktopAuthCancelUrl('https://evil.example.test/desktop-auth/complete')).toBe('');
  });

  it('parses a desktop browser handoff with capabilities in the URL fragment', () => {
    const handoff = resolveDesktopBrowserHandoff(
      '?desktopAuthRequest=req-1',
      '#desktopAuthSecret=secret-1&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthTransport=form_post&desktopAuthReturnTo=%2Fcheckout'
    );

    expect(handoff.active).toBe(true);
    expect(handoff.callbackUrl).toBe('http://127.0.0.1:47831/desktop-auth/complete');
    expect(handoff.returnTo).toBe('/checkout');
    expect(handoff.transport).toBe('form_post');
  });

  it('keeps accepting legacy query handoffs during desktop client rollout', () => {
    const handoff = resolveDesktopBrowserHandoff(
      '?desktopAuthRequest=req-legacy&desktopAuthSecret=secret-legacy&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete'
    );

    expect(handoff.active).toBe(true);
    expect(handoff.callbackUrl).toBe('http://127.0.0.1:47831/desktop-auth/complete');
    expect(handoff.transport).toBe('');
  });

  it('stores and removes inline desktop capabilities from the visible route', async () => {
    renderLoginController({
      currentUser: null,
      isAuthenticated: false,
      loading: false,
    }, '/login?desktopAuthRequest=req-scrub#desktopAuthSecret=secret-scrub&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthTransport=form_post&desktopAuthReturnTo=%2Fcheckout');

    await waitFor(() => {
      expect(screen.getByTestId('location-probe')).toHaveTextContent('"search":"?desktopAuthRequest=req-scrub"');
      expect(screen.getByTestId('location-probe')).toHaveTextContent('"hash":""');
    });

    const restored = resolveDesktopBrowserHandoff('?desktopAuthRequest=req-scrub');
    expect(restored).toMatchObject({
      active: true,
      callbackUrl: 'http://127.0.0.1:47831/desktop-auth/complete',
      requestId: 'req-scrub',
      returnTo: '/checkout',
      secret: 'secret-scrub',
      transport: 'form_post',
    });
  });

  it('restores a Duo desktop handoff after the provider returns with only the request id', () => {
    expect(persistDesktopBrowserHandoff({
      requestId: 'req-restore-1',
      secret: 'secret-restore-1',
      callbackUrl: 'http://localhost:47831/desktop-auth/complete',
      returnTo: '/checkout',
    })).toBe(true);

    const handoff = resolveDesktopBrowserHandoff('?desktopAuthRequest=req-restore-1&duo=success');

    expect(handoff.active).toBe(true);
    expect(handoff.secret).toBe('secret-restore-1');
    expect(handoff.callbackUrl).toBe('http://127.0.0.1:47831/desktop-auth/complete');
    expect(handoff.returnTo).toBe('/checkout');
  });

  it('rejects prototype-sensitive desktop handoff request ids', () => {
    expect(persistDesktopBrowserHandoff({
      requestId: '__proto__',
      secret: 'secret-prototype',
      callbackUrl: 'http://localhost:47831/desktop-auth/complete',
    })).toBe(false);

    expect(resolveDesktopBrowserHandoff('?desktopAuthRequest=__proto__&duo=success').active).toBe(false);
    expect({}.secret).toBeUndefined();
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

  it.each([
    'device_challenge_required',
    'mfa_challenge_required',
  ])('waits for authenticated after %s before announcing success or navigating', async (checkpointStatus) => {
    vi.useFakeTimers();
    try {
      render(<AuthenticationCheckpointHarness checkpointStatus={checkpointStatus} />);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'start sign-in' }));
        await Promise.resolve();
      });

      expect(screen.getByTestId('checkpoint-pending')).toHaveTextContent('true');
      expect(screen.getByTestId('checkpoint-status')).toHaveTextContent(checkpointStatus);
      expect(screen.getByTestId('checkpoint-success')).toHaveTextContent('none');
      expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/login"');

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/login"');

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'complete checkpoint' }));
        await Promise.resolve();
      });

      expect(screen.getByTestId('checkpoint-pending')).toHaveTextContent('false');
      expect(screen.getByTestId('checkpoint-success')).not.toHaveTextContent('none');
      expect(screen.getByTestId('location-probe')).toHaveTextContent('"pathname":"/login"');

      await act(async () => {
        vi.advanceTimersByTime(1200);
      });
      expect(screen.getByText('Profile Screen')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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

  it('keeps Microsoft account collision copy provider-specific', async () => {
    const signInWithMicrosoft = vi.fn().mockRejectedValue(Object.assign(
      new Error('Firebase: Error (auth/account-exists-with-different-credential).'),
      {
        code: 'auth/account-exists-with-different-credential',
        customData: {
          email: 'user@example.com',
          _tokenResponse: {
            providerId: 'microsoft.com',
          },
        },
      },
    ));

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({ signInWithMicrosoft })}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<MicrosoftSignInProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('social-error-title')).toHaveTextContent('Microsoft Account Already Exists');
      expect(screen.getByTestId('social-error-detail')).toHaveTextContent('user@example.com');
      expect(screen.getByTestId('social-error-hint')).toHaveTextContent('link Microsoft after login');
    });

    expect(signInWithMicrosoft).toHaveBeenCalled();
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

  it('starts desktop browser sign-in only in the Electron runtime', async () => {
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
      runtimeElectronDesktop: true,
    });

    const signInWithDesktopBrowser = vi.fn().mockResolvedValue({
      dbUser: { email: 'desktop@example.com' },
    });
    const signInWithDesktopOwnerAccess = vi.fn().mockResolvedValue({
      dbUser: { email: 'owner@example.com' },
    });
    window.auraDesktop = {
      isDesktop: true,
      getAppInfo: vi.fn().mockResolvedValue({ ownerAccessSignInAvailable: true }),
    };

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({ signInWithDesktopBrowser, signInWithDesktopOwnerAccess })}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<DesktopBrowserSignInProbe />} />
              <Route path="/" element={<div>Home Screen</div>} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('desktop-browser-supported')).toHaveTextContent('true');
      expect(screen.getByTestId('desktop-browser-result')).toHaveTextContent('completed');
      expect(screen.getByTestId('desktop-owner-access-supported')).toHaveTextContent('true');
      expect(screen.getByTestId('desktop-owner-access-result')).toHaveTextContent('completed');
    });

    expect(signInWithDesktopBrowser).toHaveBeenCalledWith(expect.objectContaining({
      returnTo: '/',
      signal: expect.any(AbortSignal),
    }));
    expect(signInWithDesktopOwnerAccess).toHaveBeenCalled();
  });

  it('routes the explicit desktop admin choice through browser auth without granting a client-side role', async () => {
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
      runtimeElectronDesktop: true,
    });

    const signInWithDesktopBrowser = vi.fn().mockResolvedValue({ redirecting: true });
    window.auraDesktop = {
      isDesktop: true,
      getAppInfo: vi.fn().mockResolvedValue({ ownerAccessSignInAvailable: false }),
    };

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({ signInWithDesktopBrowser })}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<DesktopAdminSignInProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    expect(screen.getByTestId('desktop-admin-supported')).toHaveTextContent('true');
    fireEvent.click(screen.getByRole('button', { name: /start admin sign-in/i }));

    await waitFor(() => {
      expect(signInWithDesktopBrowser).toHaveBeenCalledWith(expect.objectContaining({
        returnTo: '/admin/dashboard',
        signal: expect.any(AbortSignal),
      }));
    });

    expect(signInWithDesktopBrowser.mock.calls[0][0]).not.toHaveProperty('role');
    expect(signInWithDesktopBrowser.mock.calls[0][0]).not.toHaveProperty('isAdmin');
  });

  it('exposes reopen and cancel actions while desktop browser sign-in is waiting', async () => {
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
      runtimeElectronDesktop: true,
    });

    const signInWithDesktopBrowser = vi.fn(({ signal, onRequestStarted }) => new Promise((_resolve, reject) => {
      onRequestStarted({ requestId: 'desktop-browser-reopen-1', expiresAt: Date.now() + 60_000 });
      signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('Desktop browser sign-in was cancelled.'), {
          code: 'auth/desktop-browser-sign-in-cancelled',
        }));
      }, { once: true });
    }));
    const reopenDesktopBrowserSignIn = vi.fn().mockResolvedValue({ success: true });
    window.auraDesktop = {
      isDesktop: true,
      getAppInfo: vi.fn().mockResolvedValue({ ownerAccessSignInAvailable: true }),
    };

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue({
            reopenDesktopBrowserSignIn,
            signInWithDesktopBrowser,
          })}>
            <MemoryRouter initialEntries={['/login']}>
              <Routes>
                <Route path="/login" element={<DesktopBrowserCancelProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Start browser' }));
      await waitFor(() => {
        expect(screen.getByTestId('desktop-browser-pending')).toHaveTextContent('true');
      });

      fireEvent.click(screen.getByRole('button', { name: 'Reopen browser' }));
      await waitFor(() => {
        expect(reopenDesktopBrowserSignIn).toHaveBeenCalledWith('desktop-browser-reopen-1');
      });

      fireEvent.click(screen.getByRole('button', { name: 'Cancel browser' }));
      await waitFor(() => {
        expect(screen.getByTestId('desktop-browser-pending')).toHaveTextContent('false');
        expect(screen.getByTestId('desktop-browser-cancel-title'))
          .toHaveTextContent('Sign-In Cancelled');
      });
    } finally {
      delete window.auraDesktop;
    }
  });

  it('preserves native desktop owner errors and clears the stale verifying state', async () => {
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
      runtimeElectronDesktop: true,
    });

    const signInWithDesktopOwnerAccess = vi.fn().mockRejectedValue(
      new Error('Desktop owner access could not be verified.')
    );
    window.auraDesktop = {
      isDesktop: true,
      getAppInfo: vi.fn().mockResolvedValue({ ownerAccessSignInAvailable: true }),
    };

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({ signInWithDesktopOwnerAccess })}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<DesktopOwnerAccessFailureProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('desktop-owner-error-detail'))
        .toHaveTextContent('Desktop owner access could not be verified.');
      expect(screen.getByTestId('desktop-owner-success-title')).toHaveTextContent('none');
    });

    expect(signInWithDesktopOwnerAccess).toHaveBeenCalledOnce();
  });

  it('routes desktop social sign-in clicks through the external browser bridge', async () => {
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
      runtimeElectronDesktop: true,
    });

    const signInWithGoogle = vi.fn().mockRejectedValue(new Error('Electron popup should not run'));
    const signInWithDesktopBrowser = vi.fn().mockResolvedValue({
      dbUser: { email: 'desktop-social@example.com' },
    });
    window.auraDesktop = {
      isDesktop: true,
      getAppInfo: vi.fn().mockResolvedValue({ ownerAccessSignInAvailable: false }),
    };

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({ signInWithGoogle, signInWithDesktopBrowser })}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<SocialSignInProbe />} />
              <Route path="/" element={<div>Home Screen</div>} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('social-result')).toHaveTextContent('completed');
      expect(screen.getByTestId('social-error-title')).toHaveTextContent('none');
    });

    expect(signInWithDesktopBrowser).toHaveBeenCalledWith({ returnTo: '/' });
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });

  it('keeps Duo login hidden unless the deployment explicitly enables it', () => {
    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue()}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<DuoLoginFlagProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    expect(screen.getByTestId('duo-login-enabled')).toHaveTextContent('false');
  });

  it('starts Duo desktop sign-in with a WAF-safe return URL and stores the loopback bridge locally', async () => {
    const startDuoLogin = vi.spyOn(authApi, 'startDuoLogin').mockReturnValue({
      redirecting: true,
      url: '/api/auth/duo/start',
    });
    const desktopLoginUrl = '/desktop-login?desktopAuthRequest=req-1#desktopAuthSecret=secret-1&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthTransport=form_post&desktopAuthReturnTo=%2Fcheckout';

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue()}>
          <MemoryRouter initialEntries={[desktopLoginUrl]}>
            <Routes>
              <Route path="/desktop-login" element={<DuoLoginStartProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('duo-start-result')).toHaveTextContent('completed');
    });

    const expectedReturnTo = buildDesktopDuoReturnTo('req-1');
    expect(startDuoLogin).toHaveBeenCalledWith({
      returnTo: expectedReturnTo,
    });
    expect(expectedReturnTo).toBe('/desktop-login?desktopAuthRequest=req-1');
    expect(expectedReturnTo).not.toContain('desktopAuthSecret');
    expect(expectedReturnTo).not.toContain('desktopAuthCallback');
    expect(expectedReturnTo).not.toContain('localhost');

    const restored = resolveDesktopBrowserHandoff('?desktopAuthRequest=req-1&duo=success');
    expect(restored.active).toBe(true);
    expect(restored.secret).toBe('secret-1');
    expect(restored.callbackUrl).toBe('http://127.0.0.1:47831/desktop-auth/complete');
    expect(restored.returnTo).toBe('/checkout');
    expect(restored.transport).toBe('form_post');

    startDuoLogin.mockRestore();
  });

  it('does not send the app email field as the Duo login hint', async () => {
    const startDuoLogin = vi.spyOn(authApi, 'startDuoLogin').mockReturnValue({
      redirecting: true,
      url: '/api/auth/duo/start',
    });

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue()}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<DuoLoginStartWithEmailProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { name: 'email', value: 'app.user@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'start duo' }));

    await waitFor(() => {
      expect(screen.getByTestId('duo-start-result')).toHaveTextContent('completed');
    });

    expect(startDuoLogin).toHaveBeenCalledWith({
      returnTo: '/',
    });

    startDuoLogin.mockRestore();
  });

  it('returns consumed reset grants to the recovery form instead of replaying the dead token', async () => {
    getFirebaseSocialAuthStatusMock.mockReturnValue({
      ready: false,
      supported: true,
      runtimeHost: 'localhost',
      runtimeBlocked: false,
      redirectPreferred: false,
      runtimeIpHost: false,
      disabledByConfig: false,
      initErrorCode: '',
      initErrorMessage: '',
      runtimeElectronDesktop: false,
    });
    const sendOtp = vi.spyOn(otpApi, 'sendOtp').mockResolvedValue({ success: true });
    const verifyOtp = vi.spyOn(otpApi, 'verifyOtp').mockResolvedValue({
      success: true,
      flowToken: 'flow-reset-1',
    });
    const resetPassword = vi.spyOn(otpApi, 'resetPassword').mockRejectedValue(Object.assign(
      new Error('Login assurance token already used. Please verify OTP again.'),
      {
        status: 409,
        data: { message: 'Login assurance token already used. Please verify OTP again.' },
      },
    ));

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue()}>
            <MemoryRouter initialEntries={['/login']}>
              <Routes>
                <Route path="/login" element={<ResetPasswordFailureProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'forgot' }));
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
      fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '+91 99999 99999' } });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(sendOtp).toHaveBeenCalledWith('user@example.com', '+919999999999', 'forgot-password', {});
        expect(screen.getByTestId('reset-step')).toHaveTextContent('otp');
      });

      '123456'.split('').forEach((digit, index) => {
        fireEvent.change(screen.getByLabelText(`OTP digit ${index + 1}`), { target: { value: digit } });
      });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(verifyOtp).toHaveBeenCalledWith('+919999999999', '123456', 'forgot-password', {});
        expect(screen.getByTestId('reset-step')).toHaveTextContent('reset-password');
      });

      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'OrbitPass!123' } });
      fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'OrbitPass!123' } });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(resetPassword).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('reset-step')).toHaveTextContent('form');
        expect(screen.getByTestId('reset-error-title')).toHaveTextContent('Recovery Session Expired');
        expect(screen.getByTestId('reset-error-hint')).toHaveTextContent('Request a fresh OTP');
      });

      fireEvent.click(screen.getByRole('button', { name: 'submit' }));
      expect(resetPassword).toHaveBeenCalledTimes(1);
    } finally {
      sendOtp.mockRestore();
      verifyOtp.mockRestore();
      resetPassword.mockRestore();
    }
  });

  it('returns rate-limited reset attempts to the recovery form instead of replaying the throttled token', async () => {
    getFirebaseSocialAuthStatusMock.mockReturnValue({
      ready: false,
      supported: true,
      runtimeHost: 'localhost',
      runtimeBlocked: false,
      redirectPreferred: false,
      runtimeIpHost: false,
      disabledByConfig: false,
      initErrorCode: '',
      initErrorMessage: '',
      runtimeElectronDesktop: false,
    });
    const sendOtp = vi.spyOn(otpApi, 'sendOtp').mockResolvedValue({ success: true });
    const verifyOtp = vi.spyOn(otpApi, 'verifyOtp').mockResolvedValue({
      success: true,
      flowToken: 'flow-reset-rate-limited',
    });
    const resetPassword = vi.spyOn(otpApi, 'resetPassword').mockRejectedValue(Object.assign(
      new Error('Too many password reset attempts. Please wait before trying again.'),
      {
        status: 429,
        data: { message: 'Too many password reset attempts. Please wait before trying again.' },
      },
    ));

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue()}>
            <MemoryRouter initialEntries={['/login']}>
              <Routes>
                <Route path="/login" element={<ResetPasswordFailureProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'forgot' }));
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
      fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '+91 99999 99999' } });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(sendOtp).toHaveBeenCalledWith('user@example.com', '+919999999999', 'forgot-password', {});
        expect(screen.getByTestId('reset-step')).toHaveTextContent('otp');
      });

      '123456'.split('').forEach((digit, index) => {
        fireEvent.change(screen.getByLabelText(`OTP digit ${index + 1}`), { target: { value: digit } });
      });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(verifyOtp).toHaveBeenCalledWith('+919999999999', '123456', 'forgot-password', {});
        expect(screen.getByTestId('reset-step')).toHaveTextContent('reset-password');
      });

      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'OrbitPass!123' } });
      fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'OrbitPass!123' } });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(resetPassword).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('reset-step')).toHaveTextContent('form');
        expect(screen.getByTestId('reset-error-title')).toHaveTextContent('Too Many Reset Attempts');
        expect(screen.getByTestId('reset-error-hint')).toHaveTextContent('Wait a few minutes');
      });

      fireEvent.click(screen.getByRole('button', { name: 'submit' }));
      expect(resetPassword).toHaveBeenCalledTimes(1);
    } finally {
      sendOtp.mockRestore();
      verifyOtp.mockRestore();
      resetPassword.mockRestore();
    }
  });

  it('returns server-side 503/500 failures to the recovery form to prevent token replay', async () => {
    getFirebaseSocialAuthStatusMock.mockReturnValue({
      ready: false,
      supported: true,
      runtimeHost: 'localhost',
      runtimeBlocked: false,
      redirectPreferred: false,
      runtimeIpHost: false,
      disabledByConfig: false,
      initErrorCode: '',
      initErrorMessage: '',
      runtimeElectronDesktop: false,
    });
    const sendOtp = vi.spyOn(otpApi, 'sendOtp').mockResolvedValue({ success: true });
    const verifyOtp = vi.spyOn(otpApi, 'verifyOtp').mockResolvedValue({
      success: true,
      flowToken: 'flow-reset-503',
    });
    const resetPassword = vi.spyOn(otpApi, 'resetPassword').mockRejectedValue(Object.assign(
      new Error('Unable to update password right now. Please try again shortly.'),
      {
        status: 503,
        data: { message: 'Unable to update password right now. Please try again shortly.' },
      },
    ));

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue()}>
            <MemoryRouter initialEntries={['/login']}>
              <Routes>
                <Route path="/login" element={<ResetPasswordFailureProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'forgot' }));
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
      fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '+91 99999 99999' } });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(sendOtp).toHaveBeenCalledWith('user@example.com', '+919999999999', 'forgot-password', {});
        expect(screen.getByTestId('reset-step')).toHaveTextContent('otp');
      });

      '123456'.split('').forEach((digit, index) => {
        fireEvent.change(screen.getByLabelText(`OTP digit ${index + 1}`), { target: { value: digit } });
      });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(verifyOtp).toHaveBeenCalledWith('+919999999999', '123456', 'forgot-password', {});
        expect(screen.getByTestId('reset-step')).toHaveTextContent('reset-password');
      });

      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'OrbitPass!123' } });
      fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'OrbitPass!123' } });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(resetPassword).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('reset-step')).toHaveTextContent('form');
      });

      fireEvent.click(screen.getByRole('button', { name: 'submit' }));
      expect(resetPassword).toHaveBeenCalledTimes(1);
    } finally {
      sendOtp.mockRestore();
      verifyOtp.mockRestore();
      resetPassword.mockRestore();
    }
  });

  it('ignores a second reset submit while the first request is still pending', async () => {
    getFirebaseSocialAuthStatusMock.mockReturnValue({
      ready: false,
      supported: true,
      runtimeHost: 'localhost',
      runtimeBlocked: false,
      redirectPreferred: false,
      runtimeIpHost: false,
      disabledByConfig: false,
      initErrorCode: '',
      initErrorMessage: '',
      runtimeElectronDesktop: false,
    });
    const sendOtp = vi.spyOn(otpApi, 'sendOtp').mockResolvedValue({ success: true });
    const verifyOtp = vi.spyOn(otpApi, 'verifyOtp').mockResolvedValue({
      success: true,
      flowToken: 'flow-reset-pending',
    });
    let rejectResetPassword;
    const resetPassword = vi.spyOn(otpApi, 'resetPassword').mockImplementation(() => (
      new Promise((resolve, reject) => {
        rejectResetPassword = reject;
      })
    ));

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue()}>
            <MemoryRouter initialEntries={['/login']}>
              <Routes>
                <Route path="/login" element={<ResetPasswordFailureProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'forgot' }));
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
      fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '+91 99999 99999' } });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(sendOtp).toHaveBeenCalledWith('user@example.com', '+919999999999', 'forgot-password', {});
        expect(screen.getByTestId('reset-step')).toHaveTextContent('otp');
      });

      '123456'.split('').forEach((digit, index) => {
        fireEvent.change(screen.getByLabelText(`OTP digit ${index + 1}`), { target: { value: digit } });
      });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      await waitFor(() => {
        expect(verifyOtp).toHaveBeenCalledWith('+919999999999', '123456', 'forgot-password', {});
        expect(screen.getByTestId('reset-step')).toHaveTextContent('reset-password');
      });

      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'OrbitPass!123' } });
      fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'OrbitPass!123' } });
      fireEvent.click(screen.getByRole('button', { name: 'double-submit' }));

      await waitFor(() => {
        expect(resetPassword).toHaveBeenCalledTimes(1);
      });

      rejectResetPassword(Object.assign(
        new Error('Unable to update password right now. Please try again shortly.'),
        { status: 503 }
      ));

      await waitFor(() => {
        expect(screen.getByTestId('reset-step')).toHaveTextContent('form');
      });
    } finally {
      sendOtp.mockRestore();
      verifyOtp.mockRestore();
      resetPassword.mockRestore();
    }
  });

  it('keeps an active desktop handoff neutral until session hydration resolves', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174009';
    const currentUser = {
      email: 'hydrated@example.com',
      getIdToken: vi.fn(),
    };
    const renderTree = (loading) => (
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue({
          currentUser,
          isAuthenticated: true,
          loading,
        })}>
          <MemoryRouter initialEntries={[`/desktop-login?desktopAuthRequest=${requestId}#desktopAuthSecret=secret-hydration&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthTransport=form_post`]}>
            <Routes>
              <Route path="/desktop-login" element={<DesktopBrowserHandoffProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    const view = render(renderTree(true));
    expect(screen.getByTestId('desktop-session-hydrating')).toHaveTextContent('true');
    expect(screen.getByTestId('desktop-consent-ready')).toHaveTextContent('false');

    view.rerender(renderTree(false));

    await waitFor(() => {
      expect(screen.getByTestId('desktop-session-hydrating')).toHaveTextContent('false');
      expect(screen.getByTestId('desktop-consent-ready')).toHaveTextContent('true');
      expect(screen.getByTestId('desktop-consent-submitting')).toHaveTextContent('false');
    });
  });

  it('finishes a Duo desktop handoff with a top-level form navigation to loopback', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174000';
    const ambientFirebaseUser = {
      email: 'stale-firebase-user@example.com',
      getIdToken: vi.fn(),
    };
    const getSession = vi.spyOn(authApi, 'getSession').mockResolvedValue(
      buildDesktopCookieSessionPayload()
    );
    const createToken = vi.spyOn(authApi, 'createDesktopHandoffToken').mockResolvedValue({
      success: true,
      customToken: 'duo-desktop-custom-token',
    });
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue({
            currentUser: ambientFirebaseUser,
            isAuthenticated: false,
            loading: false,
          })}>
            <MemoryRouter initialEntries={[`/desktop-login?desktopAuthRequest=${requestId}&duo=success#desktopAuthSecret=secret-1&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthTransport=form_post&desktopAuthReturnTo=%2Fcheckout`]}>
              <Routes>
                <Route path="/desktop-login" element={<DesktopBrowserHandoffProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('desktop-consent-ready')).toHaveTextContent('true');
      });
      expect(getSession).toHaveBeenCalledWith({ preferCookieSession: true });
      expect(screen.getByTestId('desktop-consent-identity')).toHaveTextContent('duo@example.com');
      expect(screen.getByTestId('desktop-consent-identity')).not.toHaveTextContent(ambientFirebaseUser.email);
      expect(createToken).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Continue desktop handoff' }));

      await waitFor(() => {
        expect(createToken).toHaveBeenCalledWith({
          firebaseUser: null,
          preferCookieSession: true,
          requestId,
        });
        expect(submitSpy).toHaveBeenCalledTimes(1);
      });

      const form = document.querySelector('form[action="http://127.0.0.1:47831/desktop-auth/complete"]');
      expect(form).not.toBeNull();
      expect(form.method).toBe('post');
      expect(Object.fromEntries(new FormData(form).entries())).toEqual({
        requestId,
        secret: 'secret-1',
        customToken: 'duo-desktop-custom-token',
      });
    } finally {
      getSession.mockRestore();
      createToken.mockRestore();
      submitSpy.mockRestore();
      document.querySelector('form[action="http://127.0.0.1:47831/desktop-auth/complete"]')?.remove();
    }
  });

  it('completes a cookie-only MFA preflight before token minting', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174013';
    const cookieSession = buildDesktopCookieSessionPayload({
      email: 'duo-admin@example.com',
      isAdmin: true,
      deviceMethod: 'webauthn',
      webAuthnStepUpActive: false,
    });
    const getSession = vi.spyOn(authApi, 'getSession').mockResolvedValue(cookieSession);
    const prepareDesktopHandoff = vi.spyOn(authApi, 'prepareDesktopHandoff')
      .mockResolvedValueOnce({
        status: 'mfa_challenge_required',
        mfaChallenge: { id: 'desktop-mfa-challenge' },
        mfaPolicy: { allowedMethods: ['passkey'] },
        roles: { isAdmin: true },
      })
      .mockResolvedValueOnce({ status: 'handoff_ready', handoffReady: true });
    const verifyMfaPasskeyLogin = vi.spyOn(authApi, 'verifyMfaPasskeyLogin').mockResolvedValue({
      success: true,
      deviceSessionToken: 'duo-admin-passkey-device-session',
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    const createToken = vi.spyOn(authApi, 'createDesktopHandoffToken').mockResolvedValue({
      success: true,
      customToken: 'duo-admin-desktop-custom-token',
    });
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue({
            currentUser: null,
            isAuthenticated: false,
            loading: false,
          })}>
            <MemoryRouter initialEntries={[`/desktop-login?desktopAuthRequest=${requestId}&duo=success#desktopAuthSecret=secret-duo-admin&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthTransport=form_post`]}>
              <Routes>
                <Route path="/desktop-login" element={<DesktopBrowserHandoffProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      await waitFor(() => {
        expect(getSession).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('desktop-consent-identity')).toHaveTextContent('duo-admin@example.com');
        expect(screen.getByTestId('desktop-preflight-status')).toHaveTextContent('mfa_challenge_required');
      });
      expect(createToken).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Verify browser passkey' }));
      await waitFor(() => {
        expect(verifyMfaPasskeyLogin).toHaveBeenCalledWith({
          challengeId: 'desktop-mfa-challenge',
        }, { preferCookieSession: true });
        expect(screen.getByTestId('desktop-consent-ready')).toHaveTextContent('true');
      });
      expect(createToken).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Continue desktop handoff' }));

      await waitFor(() => {
        expect(createToken).toHaveBeenCalledWith({
          firebaseUser: null,
          preferCookieSession: true,
          requestId,
        });
        expect(submitSpy).toHaveBeenCalledTimes(1);
      });
      expect(prepareDesktopHandoff).toHaveBeenNthCalledWith(1, {
        requestId,
        preferCookieSession: true,
      });
      expect(prepareDesktopHandoff).toHaveBeenNthCalledWith(2, {
        requestId,
        preferCookieSession: true,
      });
    } finally {
      getSession.mockRestore();
      verifyMfaPasskeyLogin.mockRestore();
      createToken.mockRestore();
      submitSpy.mockRestore();
      document.querySelector('form[action="http://127.0.0.1:47831/desktop-auth/complete"]')?.remove();
    }
  });

  it('blocks token minting when preflight fails and allows an explicit retry', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174014';
    const currentUser = { email: 'admin-fallback@example.com', getIdToken: vi.fn() };
    const prepareDesktopHandoff = vi.spyOn(authApi, 'prepareDesktopHandoff')
      .mockRejectedValueOnce(new Error('Desktop browser assurance expired.'))
      .mockResolvedValueOnce({ status: 'handoff_ready', handoffReady: true });
    const createToken = vi.spyOn(authApi, 'createDesktopHandoffToken').mockResolvedValue({
      success: true,
      customToken: 'admin-retry-custom-token',
    });
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue({
            currentUser,
            isAuthenticated: true,
            roles: { isAdmin: true, isSeller: false, isVerified: true },
            session: { deviceMethod: 'webauthn', webAuthnStepUpActive: true },
          })}>
            <MemoryRouter initialEntries={[`/desktop-login?desktopAuthRequest=${requestId}#desktopAuthSecret=secret-admin-fallback&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthTransport=form_post`]}>
              <Routes>
                <Route path="/desktop-login" element={<DesktopBrowserHandoffProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('desktop-preflight-failed')).toHaveTextContent('true');
        expect(screen.getByTestId('desktop-consent-error')).not.toHaveTextContent('none');
      });
      expect(createToken).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Continue desktop handoff' }));
      await waitFor(() => {
        expect(prepareDesktopHandoff).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('desktop-consent-ready')).toHaveTextContent('true');
      });
      expect(createToken).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Continue desktop handoff' }));
      await waitFor(() => {
        expect(createToken).toHaveBeenCalledTimes(1);
        expect(submitSpy).toHaveBeenCalledTimes(1);
      });
    } finally {
      createToken.mockRestore();
      submitSpy.mockRestore();
      document.querySelector('form[action="http://127.0.0.1:47831/desktop-auth/complete"]')?.remove();
    }
  });

  it('does not transfer a browser-device checkpoint to a replacement desktop request', async () => {
    const firstRequestId = '123e4567-e89b-12d3-a456-426614174015';
    const nextRequestId = '123e4567-e89b-12d3-a456-426614174016';
    const currentUser = { email: 'admin-reset@example.com', getIdToken: vi.fn() };
    const prepareDesktopHandoff = vi.spyOn(authApi, 'prepareDesktopHandoff')
      .mockResolvedValueOnce({
        status: 'device_challenge_required',
        deviceChallenge: {
          token: 'first-browser-device-challenge',
          scope: 'desktop_handoff_source',
        },
      })
      .mockResolvedValueOnce({ status: 'handoff_ready', handoffReady: true });
    const createToken = vi.spyOn(authApi, 'createDesktopHandoffToken');

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue({
            currentUser,
            isAuthenticated: true,
            roles: { isAdmin: true, isSeller: false, isVerified: true },
            session: { deviceMethod: 'webauthn', webAuthnStepUpActive: true },
          })}>
            <MemoryRouter initialEntries={[`/desktop-login?desktopAuthRequest=${firstRequestId}#desktopAuthSecret=secret-first-request&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthTransport=form_post`]}>
              <Routes>
                <Route
                  path="/desktop-login"
                  element={<DesktopBrowserHandoffNavigationProbe nextRequestId={nextRequestId} />}
                />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('desktop-preflight-status')).toHaveTextContent('device_challenge_required');
      });

      fireEvent.click(screen.getByRole('button', { name: 'Start next desktop request' }));
      await waitFor(() => {
        expect(screen.getByTestId('desktop-preflight-status')).toHaveTextContent('none');
        expect(screen.getByTestId('desktop-consent-ready')).toHaveTextContent('true');
      });
      expect(prepareDesktopHandoff).toHaveBeenNthCalledWith(1, {
        requestId: firstRequestId,
        firebaseUser: currentUser,
      });
      expect(prepareDesktopHandoff).toHaveBeenNthCalledWith(2, {
        requestId: nextRequestId,
        firebaseUser: currentUser,
      });
      expect(createToken).not.toHaveBeenCalled();
    } finally {
      createToken.mockRestore();
    }
  });

  it('keeps the fresh desktop handoff lifecycle available to regular users without an admin passkey gate', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174010';
    const currentUser = { email: 'customer@example.com', getIdToken: vi.fn() };
    const verifyMfaPasskeyChallenge = vi.fn();
    const registerMfaPasskey = vi.fn();
    const createToken = vi.spyOn(authApi, 'createDesktopHandoffToken').mockResolvedValue({
      success: true,
      customToken: 'customer-desktop-custom-token',
    });
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue({
            currentUser,
            isAuthenticated: true,
            roles: { isAdmin: false, isSeller: false, isVerified: true },
            session: { deviceMethod: 'browser_key', webAuthnStepUpActive: false },
            registerMfaPasskey,
            verifyMfaPasskeyChallenge,
          })}>
            <MemoryRouter initialEntries={[`/desktop-login?desktopAuthRequest=${requestId}#desktopAuthSecret=secret-customer&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthTransport=form_post`]}>
              <Routes>
                <Route path="/desktop-login" element={<DesktopBrowserHandoffProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('desktop-consent-action-label')).toHaveTextContent('Continue');
        expect(screen.getByTestId('desktop-consent-ready')).toHaveTextContent('true');
      });
      fireEvent.click(screen.getByRole('button', { name: 'Continue desktop handoff' }));

      await waitFor(() => {
        expect(createToken).toHaveBeenCalledWith({ firebaseUser: currentUser, requestId });
        expect(submitSpy).toHaveBeenCalledTimes(1);
      });
      expect(verifyMfaPasskeyChallenge).not.toHaveBeenCalled();
      expect(registerMfaPasskey).not.toHaveBeenCalled();
    } finally {
      createToken.mockRestore();
      submitSpy.mockRestore();
      document.querySelector('form[action="http://127.0.0.1:47831/desktop-auth/complete"]')?.remove();
    }
  });

  it('waits for the server-issued admin MFA checkpoint before minting a token', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174011';
    const currentUser = { email: 'admin@example.com', getIdToken: vi.fn() };
    let resolvePasskey;
    vi.spyOn(authApi, 'prepareDesktopHandoff')
      .mockResolvedValueOnce({
        status: 'mfa_challenge_required',
        mfaChallenge: { id: 'desktop-mfa-challenge' },
        mfaPolicy: { allowedMethods: ['passkey'] },
        roles: { isAdmin: true },
      })
      .mockResolvedValueOnce({ status: 'handoff_ready', handoffReady: true });
    const verifyMfaPasskeyLogin = vi.spyOn(authApi, 'verifyMfaPasskeyLogin').mockImplementation(
      () => new Promise((resolve) => {
        resolvePasskey = resolve;
      })
    );
    const createToken = vi.spyOn(authApi, 'createDesktopHandoffToken').mockResolvedValue({
      success: true,
      customToken: 'admin-desktop-custom-token',
    });
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue({
            currentUser,
            isAuthenticated: true,
            roles: { isAdmin: true, isSeller: false, isVerified: true },
            session: { deviceMethod: 'webauthn', webAuthnStepUpActive: false },
          })}>
            <MemoryRouter initialEntries={[`/desktop-login?desktopAuthRequest=${requestId}#desktopAuthSecret=secret-admin&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthTransport=form_post`]}>
              <Routes>
                <Route path="/desktop-login" element={<DesktopBrowserHandoffProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('desktop-preflight-status')).toHaveTextContent('mfa_challenge_required');
      });
      fireEvent.click(screen.getByRole('button', { name: 'Verify browser passkey' }));

      await waitFor(() => {
        expect(verifyMfaPasskeyLogin).toHaveBeenCalledWith(
          { challengeId: 'desktop-mfa-challenge' },
          { firebaseUser: currentUser }
        );
      });
      expect(createToken).not.toHaveBeenCalled();
      expect(screen.getByTestId('desktop-consent-success')).toHaveTextContent('none');

      await act(async () => {
        resolvePasskey({ success: true });
      });

      await waitFor(() => {
        expect(screen.getByTestId('desktop-consent-ready')).toHaveTextContent('true');
      });
      expect(createToken).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Continue desktop handoff' }));
      await waitFor(() => {
        expect(createToken).toHaveBeenCalledWith({ firebaseUser: currentUser, requestId });
        expect(submitSpy).toHaveBeenCalledTimes(1);
      });
    } finally {
      createToken.mockRestore();
      submitSpy.mockRestore();
      document.querySelector('form[action="http://127.0.0.1:47831/desktop-auth/complete"]')?.remove();
    }
  });

  it('completes the browser-device checkpoint before enabling consent', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174017';
    const currentUser = { email: 'device-checkpoint@example.com', getIdToken: vi.fn() };
    vi.spyOn(authApi, 'prepareDesktopHandoff')
      .mockResolvedValueOnce({
        status: 'device_challenge_required',
        deviceChallenge: {
          token: 'browser-device-challenge',
          scope: 'desktop_handoff_source',
        },
      })
      .mockResolvedValueOnce({ status: 'handoff_ready', handoffReady: true });
    const verifyDeviceChallenge = vi.spyOn(authApi, 'verifyDeviceChallenge').mockResolvedValue({
      success: true,
      deviceSessionToken: 'browser-device-session',
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    const createToken = vi.spyOn(authApi, 'createDesktopHandoffToken');

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue({
            currentUser,
            isAuthenticated: true,
            roles: { isAdmin: false, isSeller: false, isVerified: true },
          })}>
            <MemoryRouter initialEntries={[`/desktop-login?desktopAuthRequest=${requestId}#desktopAuthSecret=secret-device-checkpoint&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthTransport=form_post`]}>
              <Routes>
                <Route path="/desktop-login" element={<DesktopBrowserHandoffProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('desktop-preflight-status')).toHaveTextContent('device_challenge_required');
      });
      expect(createToken).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Verify browser device' }));
      await waitFor(() => {
        expect(verifyDeviceChallenge).toHaveBeenCalledWith(
          'browser-device-challenge',
          { method: 'browser_key', proofBase64: 'browser-device-proof' },
          '',
          { firebaseUser: currentUser }
        );
        expect(screen.getByTestId('desktop-consent-ready')).toHaveTextContent('true');
      });
      expect(createToken).not.toHaveBeenCalled();
    } finally {
      createToken.mockRestore();
    }
  });

  it('clears preflight submission state when the same desktop request restarts', async () => {
    const firstRequestId = '123e4567-e89b-12d3-a456-426614174019';
    const nextRequestId = '123e4567-e89b-12d3-a456-426614174020';
    const currentUser = { email: 'desktop-reopen@example.com', getIdToken: vi.fn() };
    let resolveFirstMint;
    const createToken = vi.spyOn(authApi, 'createDesktopHandoffToken')
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstMint = resolve;
      }))
      .mockResolvedValueOnce({ success: true, customToken: 'reopened-desktop-custom-token' });
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue({
            currentUser,
            isAuthenticated: true,
            roles: { isAdmin: false, isSeller: false, isVerified: true },
          })}>
            <MemoryRouter initialEntries={[`/desktop-login?desktopAuthRequest=${firstRequestId}#desktopAuthSecret=secret-roundtrip-first&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthTransport=form_post`]}>
              <Routes>
                <Route
                  path="/desktop-login"
                  element={(
                    <DesktopBrowserHandoffRoundTripProbe
                      firstRequestId={firstRequestId}
                      nextRequestId={nextRequestId}
                    />
                  )}
                />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('desktop-consent-ready')).toHaveTextContent('true');
      });
      fireEvent.click(screen.getByRole('button', { name: 'Continue desktop handoff' }));
      await waitFor(() => {
        expect(createToken).toHaveBeenCalledTimes(1);
      });

      fireEvent.click(screen.getByRole('button', { name: 'Start roundtrip next request' }));
      await waitFor(() => {
        expect(screen.getByTestId('desktop-roundtrip-location')).toHaveTextContent(nextRequestId);
      });
      fireEvent.click(screen.getByRole('button', { name: 'Reopen roundtrip first request' }));
      await waitFor(() => {
        expect(screen.getByTestId('desktop-roundtrip-location')).toHaveTextContent(firstRequestId);
        expect(screen.getByTestId('desktop-consent-ready')).toHaveTextContent('true');
        expect(screen.getByTestId('desktop-consent-submitting')).toHaveTextContent('false');
      });

      await act(async () => {
        resolveFirstMint({ success: true, customToken: 'discarded-old-custom-token' });
      });
      expect(submitSpy).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Continue desktop handoff' }));
      await waitFor(() => {
        expect(createToken).toHaveBeenCalledTimes(2);
        expect(createToken).toHaveBeenLastCalledWith({
          firebaseUser: currentUser,
          requestId: firstRequestId,
        });
        expect(submitSpy).toHaveBeenCalledTimes(1);
      });
    } finally {
      createToken.mockRestore();
      submitSpy.mockRestore();
      document.querySelector('form[action="http://127.0.0.1:47831/desktop-auth/complete"]')?.remove();
    }
  });

  it('does not mint or display success when an MFA checkpoint fails', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174012';
    const currentUser = { email: 'admin@example.com', getIdToken: vi.fn() };
    vi.spyOn(authApi, 'prepareDesktopHandoff').mockResolvedValueOnce({
      status: 'mfa_challenge_required',
      mfaChallenge: { id: 'desktop-mfa-challenge' },
      mfaPolicy: { allowedMethods: ['passkey'] },
      roles: { isAdmin: true },
    });
    const verifyMfaPasskeyLogin = vi.spyOn(authApi, 'verifyMfaPasskeyLogin')
      .mockRejectedValue(new Error('Passkey verification was cancelled.'));
    const createToken = vi.spyOn(authApi, 'createDesktopHandoffToken');

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue({
            currentUser,
            isAuthenticated: true,
            roles: { isAdmin: true, isSeller: false, isVerified: true },
            session: { deviceMethod: 'webauthn', webAuthnStepUpActive: false },
          })}>
            <MemoryRouter initialEntries={[`/desktop-login?desktopAuthRequest=${requestId}#desktopAuthSecret=secret-admin-cancel&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthTransport=form_post`]}>
              <Routes>
                <Route path="/desktop-login" element={<DesktopBrowserHandoffProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('desktop-preflight-status')).toHaveTextContent('mfa_challenge_required');
      });

      fireEvent.click(screen.getByRole('button', { name: 'Verify browser passkey' }));
      await waitFor(() => {
        expect(verifyMfaPasskeyLogin).toHaveBeenCalled();
        expect(screen.getByTestId('desktop-preflight-failed')).toHaveTextContent('true');
        expect(screen.getByTestId('desktop-consent-error')).not.toHaveTextContent('none');
      });
      expect(createToken).not.toHaveBeenCalled();
      expect(screen.getByTestId('desktop-consent-success')).toHaveTextContent('none');
    } finally {
      createToken.mockRestore();
    }
  });

  it('keeps JSON callback completion for desktop releases without the form capability', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174001';
    const getSession = vi.spyOn(authApi, 'getSession').mockResolvedValue(
      buildDesktopCookieSessionPayload()
    );
    const createToken = vi.spyOn(authApi, 'createDesktopHandoffToken').mockResolvedValue({
      success: true,
      customToken: 'legacy-desktop-custom-token',
    });
    const previousFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue({
            currentUser: null,
            isAuthenticated: false,
            loading: false,
          })}>
            <MemoryRouter initialEntries={[`/desktop-login?desktopAuthRequest=${requestId}&duo=success#desktopAuthSecret=secret-legacy&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete`]}>
              <Routes>
                <Route path="/desktop-login" element={<DesktopBrowserHandoffProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('desktop-consent-ready')).toHaveTextContent('true');
      });
      expect(createToken).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Continue desktop handoff' }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          'http://127.0.0.1:47831/desktop-auth/complete',
          expect.objectContaining({ method: 'POST' })
        );
      });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        requestId,
        secret: 'secret-legacy',
        customToken: 'legacy-desktop-custom-token',
      });
    } finally {
      getSession.mockRestore();
      createToken.mockRestore();
      vi.stubGlobal('fetch', previousFetch);
    }
  });

  it('cancels a verified desktop handoff without minting a desktop token', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174002';
    const createToken = vi.spyOn(authApi, 'createDesktopHandoffToken');
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue({
            currentUser: { email: 'verified@example.com', getIdToken: vi.fn() },
            isAuthenticated: true,
            loading: false,
          })}>
            <MemoryRouter initialEntries={[`/desktop-login?desktopAuthRequest=${requestId}#desktopAuthSecret=secret-cancel&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthTransport=form_post`]}>
              <Routes>
                <Route path="/desktop-login" element={<DesktopBrowserHandoffProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('desktop-consent-ready')).toHaveTextContent('true');
      });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel desktop handoff' }));

      expect(createToken).not.toHaveBeenCalled();
      expect(submitSpy).toHaveBeenCalledTimes(1);
      const form = document.querySelector('form[action="http://127.0.0.1:47831/desktop-auth/cancel"]');
      expect(form).not.toBeNull();
      expect(Object.fromEntries(new FormData(form).entries())).toEqual({
        requestId,
        secret: 'secret-cancel',
      });
    } finally {
      createToken.mockRestore();
      submitSpy.mockRestore();
      document.querySelector('form[action="http://127.0.0.1:47831/desktop-auth/cancel"]')?.remove();
    }
  });

  it('does not present a browser-editable email as the verified consent identity', async () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174003';
    const getSession = vi.spyOn(authApi, 'getSession').mockResolvedValue(
      buildDesktopCookieSessionPayload({ email: 'verified-duo@example.com' })
    );

    try {
      render(
        <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
          <AuthContext.Provider value={buildAuthValue({
            currentUser: null,
            isAuthenticated: false,
            loading: false,
          })}>
            <MemoryRouter initialEntries={[{
              pathname: '/desktop-login',
              search: `?desktopAuthRequest=${requestId}&duo=success`,
              hash: '#desktopAuthSecret=secret-neutral&desktopAuthCallback=http%3A%2F%2Flocalhost%3A47831%2Fdesktop-auth%2Fcomplete&desktopAuthTransport=form_post',
              state: { authPrefill: { email: 'browser-edited@example.com' } },
            }]}
            >
              <Routes>
                <Route path="/desktop-login" element={<DesktopBrowserHandoffProbe />} />
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </MarketProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('desktop-consent-ready')).toHaveTextContent('true');
      });
      expect(screen.getByTestId('desktop-consent-identity')).toHaveTextContent('verified-duo@example.com');
      expect(screen.getByTestId('desktop-consent-identity')).not.toHaveTextContent('browser-edited@example.com');
    } finally {
      getSession.mockRestore();
    }
  });

  it('summarizes only enabled expanded social providers', () => {
    getFirebaseSocialAuthStatusMock.mockReturnValue({
      ready: true,
      supported: true,
      runtimeHost: 'dbtrhsolhec1s.cloudfront.net',
      runtimeBlocked: false,
      redirectPreferred: false,
      runtimeIpHost: false,
      disabledByConfig: false,
      microsoftEnabled: true,
      appleEnabled: false,
      initErrorCode: '',
      initErrorMessage: '',
    });

    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue()}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<SecureSignalsProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    expect(screen.getByTestId('social-access-signal')).toHaveTextContent('Google, Facebook, GitHub, X, and Microsoft ready');
    expect(screen.getByTestId('social-access-signal')).not.toHaveTextContent('Apple');
  });

  it('keeps phone input international while letting users pick a country code', async () => {
    render(
      <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        <AuthContext.Provider value={buildAuthValue()}>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<PhoneCountryProbe />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </MarketProvider>
    );

    expect(screen.getByTestId('phone-country')).toHaveTextContent('IN');

    fireEvent.change(screen.getByLabelText('Country calling code'), { target: { value: 'GB' } });
    fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '7911 123456' } });

    expect(screen.getByTestId('phone-country')).toHaveTextContent('GB');
    expect(screen.getByTestId('phone-local')).toHaveTextContent('7911123456');
    expect(screen.getByTestId('phone-full')).toHaveTextContent('+447911123456');

    fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '+1 202 555 0142' } });

    await waitFor(() => {
      expect(screen.getByTestId('phone-country')).toHaveTextContent('US');
      expect(screen.getByTestId('phone-local')).toHaveTextContent('2025550142');
      expect(screen.getByTestId('phone-full')).toHaveTextContent('+12025550142');
    });
  });
});
