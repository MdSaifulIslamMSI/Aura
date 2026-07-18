import { Suspense, useEffect, useMemo, useState } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useIntl } from 'react-intl';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CommerceProvider } from './context/CommerceContext';
import { ColorModeProvider } from './context/ColorModeContext';
import { MarketProvider } from './context/MarketContext';
import { LocaleProvider } from './i18n/LocaleProvider';
import { MotionModeProvider, useMotionMode } from './context/MotionModeContext';
import { SocketProvider } from './context/SocketContext';
import { AdminAccessLockedState, AdminRoute, ProtectedRoute, SellerRoute } from './components/shared/ProtectedRoute';
import { NotificationProvider } from './context/NotificationContext';
import { EmergencyStatusProvider, useEmergencyStatus } from './context/EmergencyStatusContext';

import Navbar, { NavbarFailureFallback } from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import ScrollToTop from './components/shared/ScrollToTop';
import SmoothScrollManager from './components/shared/SmoothScrollManager';
import ScrollProgressBar from './components/shared/ScrollProgressBar';
import SectionAnchorRail from './components/shared/SectionAnchorRail';
import RouteTransitionShell from './components/shared/RouteTransitionShell';
import AppErrorBoundary from './components/shared/AppErrorBoundary';
import BackendStatusBanner from './components/shared/BackendStatusBanner';
import EmergencyBanner from './components/shared/EmergencyBanner';
import DesktopUpdateBanner from './components/shared/DesktopUpdateBanner';
import DesktopWelcomePanel from './components/shared/DesktopWelcomePanel';
import MobileUpdateBanner from './components/shared/MobileUpdateBanner';
import MobileNativeTabBar from './components/shared/MobileNativeTabBar';
import SecurePathDock from './components/shared/SecurePathDock';
import PremiumWelcomeCurtain from './components/welcome/PremiumWelcomeCurtain';
import AuthCheckpointLayer from './components/features/auth/AuthCheckpointLayer';
import { trustRoutes } from './config/trustContent';
import { FRONTEND_LAUNCH_HUB_PATH } from './config/frontendTargets';
import { assertRouteA11yContracts } from './utils/a11yContracts';
import { ADMIN_ACCESS_LOCK_EVENT, getAdminAccessLockFromIntelligence } from './utils/adminAccessLock';
import { getNativeMobilePlatform, isCapacitorNativeRuntime } from './utils/nativeRuntime';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { MultimodalAssistantProvider } from './context/MultimodalAssistantContext';
import {
  DESKTOP_LOGIN_PATH,
  isDesktopAuthLoginRequest,
  shouldShowSiteChrome,
  shouldShowAmbientChrome,
  shouldShowBackendStatusBanner,
  shouldShowPremiumWelcomeCurtain,
} from './services/assistantUiConfig';

// Pages (Lazy Loaded for Performance)
const Home = lazyWithRetry(() => import('./pages/Home'), 'home');
const Login = lazyWithRetry(() => import('./pages/Login'), 'login');
const ProductListing = lazyWithRetry(() => import('./pages/ProductListing'), 'product-listing');
const ProductDetails = lazyWithRetry(() => import('./pages/ProductDetails'), 'product-details');
const Cart = lazyWithRetry(() => import('./pages/Cart'), 'cart');
const Wishlist = lazyWithRetry(() => import('./pages/Wishlist'), 'wishlist');
const Checkout = lazyWithRetry(() => import('./pages/Checkout'), 'checkout');
const Orders = lazyWithRetry(() => import('./pages/Orders'), 'orders');
const StatusPage = lazyWithRetry(() => import('./pages/Status'), 'status');
const StatusHistoryPage = lazyWithRetry(() => import('./pages/Status/History'), 'status-history');
const StatusIncidentDetailPage = lazyWithRetry(() => import('./pages/Status/IncidentDetail'), 'status-incident');
const StatusSubscribePage = lazyWithRetry(() => import('./pages/Status/Subscribe'), 'status-subscribe');

// Admin Pages
const AdminDashboard = lazyWithRetry(() => import('./pages/Admin/Dashboard'), 'admin-dashboard');
const ProductList = lazyWithRetry(() => import('./pages/Admin/ProductList'), 'admin-products');
const ProductEdit = lazyWithRetry(() => import('./pages/Admin/ProductEdit'), 'admin-product-edit');
const OrderList = lazyWithRetry(() => import('./pages/Admin/OrderList'), 'admin-orders');
const AdminPayments = lazyWithRetry(() => import('./pages/Admin/Payments'), 'admin-payments');
const AdminUsers = lazyWithRetry(() => import('./pages/Admin/Users'), 'admin-users');
const AdminRefundLedger = lazyWithRetry(() => import('./pages/Admin/RefundLedger'), 'admin-refunds');
const AdminEmailOps = lazyWithRetry(() => import('./pages/Admin/EmailOps'), 'admin-email-ops');
const AdminSupport = lazyWithRetry(() => import('./pages/Admin/Support'), 'admin-support');
const AdminEmergencyControls = lazyWithRetry(() => import('./pages/Admin/EmergencyControls'), 'admin-emergency-controls');
const AdminStatusDashboard = lazyWithRetry(() => import('./pages/Admin/StatusDashboard'), 'admin-status');
const AdminAwsControl = lazyWithRetry(() => import('./pages/Admin/AwsControl'), 'admin-aws-control');

// Marketplace Pages
const Sell = lazyWithRetry(() => import('./pages/Sell'), 'sell');
const Marketplace = lazyWithRetry(() => import('./pages/Marketplace'), 'marketplace');
const ListingDetail = lazyWithRetry(() => import('./pages/ListingDetail'), 'listing-detail');
const SellerProfile = lazyWithRetry(() => import('./pages/SellerProfile'), 'seller-profile');
const MyListings = lazyWithRetry(() => import('./pages/MyListings'), 'my-listings');
const ProfilePage = lazyWithRetry(() => import('./pages/Profile'), 'profile');
const TradeInPage = lazyWithRetry(() => import('./pages/TradeIn'), 'trade-in');
const PriceAlertsPage = lazyWithRetry(() => import('./pages/PriceAlerts'), 'price-alerts');
const BecomeSeller = lazyWithRetry(() => import('./pages/BecomeSeller'), 'become-seller');
const TrustPage = lazyWithRetry(() => import('./pages/Trust'), 'trust');
const ContactPage = lazyWithRetry(() => import('./pages/Contact'), 'contact');
const AICompare = lazyWithRetry(() => import('./pages/AICompare'), 'ai-compare');
const VisualSearch = lazyWithRetry(() => import('./pages/VisualSearch'), 'visual-search');
const Bundles = lazyWithRetry(() => import('./pages/Bundles'), 'bundles');
const MissionControl = lazyWithRetry(() => import('./pages/MissionControl'), 'mission-control');
const AssistantPage = lazyWithRetry(() => import('./pages/Assistant'), 'assistant-workspace');
const LaunchHub = lazyWithRetry(() => import('./pages/Launch'), 'frontend-launch-hub');
const DesktopLogin = lazyWithRetry(() => import('./pages/DesktopLogin'), 'desktop-login');

function renderRoute(element) {
  return <AppErrorBoundary>{element}</AppErrorBoundary>;
}

function renderCriticalRoute(element) {
  return element;
}

function LoginRoute() {
  const location = useLocation();

  if (isDesktopAuthLoginRequest(location.pathname, location.search)) {
    return <Navigate to={`${DESKTOP_LOGIN_PATH}${location.search}${location.hash}`} replace />;
  }

  return <Login />;
}

function EmergencyFeatureRoute({ feature, fallback, children }) {
  const { isFeatureDisabled } = useEmergencyStatus();

  if (isFeatureDisabled(feature)) {
    return fallback;
  }

  return children;
}

function AssistantDisabledNotice() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center bg-slate-950 px-6 text-slate-100">
      <div className="max-w-lg text-center">
        <p className="text-xs font-black uppercase tracking-widest text-amber-300"><StableText id={"common.jsx.text.assistant.unavailable.965f19f5"} defaultMessage={"Assistant unavailable"} /></p>
        <h1 className="mt-3 text-3xl font-black"><StableText id={"support.jsx.text.support.is.still.reachable.3120c970"} defaultMessage={"Support is still reachable."} /></h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          <StableText id={"common.jsx.text.the.ai.assistant.is.temporarily.paused.while.6d35d05b"} defaultMessage={"The AI assistant is temporarily paused while the team reviews the service. Please use the contact page for help."} />
        </p>
      </div>
    </div>
  );
}

function AppContent() {
  const intl = useIntl();
  const location = useLocation();
  const { currentUser, refreshSession, sessionIntelligence } = useAuth();
  const { effectiveMotionMode } = useMotionMode();
  const [isNativeMobile, setIsNativeMobile] = useState(() => isCapacitorNativeRuntime());
  const [reportedAdminAccessLock, setReportedAdminAccessLock] = useState(null);
  const pathname = location.pathname;
  const chromePathname = isDesktopAuthLoginRequest(location.pathname, location.search)
    ? DESKTOP_LOGIN_PATH
    : pathname;
  const routeRenderKey = `${location.pathname}${location.search}${location.hash}`;
  const isAdminPath = chromePathname.startsWith('/admin');
  const sessionAdminAccessLock = useMemo(
    () => getAdminAccessLockFromIntelligence(sessionIntelligence),
    [sessionIntelligence]
  );
  const adminAccessLock = isAdminPath ? (sessionAdminAccessLock || reportedAdminAccessLock) : null;
  const showSiteChrome = useMemo(
    () => shouldShowSiteChrome(chromePathname),
    [chromePathname]
  );
  const showPremiumWelcomeCurtain = shouldShowPremiumWelcomeCurtain(
    location.pathname,
    location.search
  );

  const showAmbientChrome = useMemo(
    () => shouldShowAmbientChrome(chromePathname),
    [chromePathname]
  );
  const showAnchorRail = showAmbientChrome && effectiveMotionMode === 'cinematic';
  const showBackendStatusBanner = useMemo(
    () => shouldShowBackendStatusBanner(chromePathname),
    [chromePathname]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleAdminAccessLock = (event) => {
      setReportedAdminAccessLock(event?.detail || null);
    };

    window.addEventListener(ADMIN_ACCESS_LOCK_EVENT, handleAdminAccessLock);
    return () => {
      window.removeEventListener(ADMIN_ACCESS_LOCK_EVENT, handleAdminAccessLock);
    };
  }, []);

  useEffect(() => {
    if (!isAdminPath && reportedAdminAccessLock) {
      setReportedAdminAccessLock(null);
    }
  }, [isAdminPath, reportedAdminAccessLock]);


  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const nativeMobile = isCapacitorNativeRuntime();
    const platform = getNativeMobilePlatform();
    const root = document.documentElement;

    setIsNativeMobile(nativeMobile);

    if (nativeMobile) {
      root.dataset.auraRuntime = 'mobile-native';
      root.dataset.auraMobilePlatform = platform || 'mobile';
    } else {
      delete root.dataset.auraRuntime;
      delete root.dataset.auraMobilePlatform;
    }

    return () => {
      delete root.dataset.auraRuntime;
      delete root.dataset.auraMobilePlatform;
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') {
      return undefined;
    }

    const rafId = window.requestAnimationFrame(() => {
      assertRouteA11yContracts(chromePathname);
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [chromePathname]);

  return (
    <div
      className={[
        'aura-app-shell flex min-h-screen min-w-0 flex-col overflow-x-hidden',
        isNativeMobile ? 'aura-native-mobile-shell' : '',
      ].filter(Boolean).join(' ')}
    >
      {showPremiumWelcomeCurtain ? <PremiumWelcomeCurtain /> : null}
      {/* Skip-to-main-content — first focusable element for keyboard/screen-reader users.
          Hidden by default, revealed on focus via sr-only + focus:not-sr-only pattern. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[9999] focus:rounded-lg focus:bg-neo-cyan focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-zinc-950 focus:shadow-lg"
      >
        <StableText id={"common.jsx.text.skip.to.main.content.a891514d"} defaultMessage={"Skip to main content"} />
      </a>
      <SmoothScrollManager />
      <ScrollToTop />
      {showAmbientChrome ? <ScrollProgressBar /> : null}
      {showAnchorRail ? <SectionAnchorRail /> : null}
      {showSiteChrome ? (
        <AppErrorBoundary fallback={<NavbarFailureFallback />}>
          <Navbar />
        </AppErrorBoundary>
      ) : null}
      {showSiteChrome ? (
        <AppErrorBoundary>
          <EmergencyBanner />
        </AppErrorBoundary>
      ) : null}
      {showSiteChrome && showBackendStatusBanner ? (
        <AppErrorBoundary>
          <BackendStatusBanner />
        </AppErrorBoundary>
      ) : null}
      <main
        id="main-content"
        className="relative z-10 flex-1 min-w-0 overflow-x-hidden"
        role="main"
        aria-label={intl.formatMessage({ id: 'app.mainContent.ariaLabel', defaultMessage: 'Main content' })}
      >
        {adminAccessLock ? (
          <AdminAccessLockedState
            adminAccessLock={adminAccessLock}
            onRetry={() => {
              setReportedAdminAccessLock(null);
              if (currentUser) {
                refreshSession(currentUser, { force: true }).catch(() => {});
              }
            }}
          />
        ) : (
          <Suspense
            key={routeRenderKey}
            fallback={(
              <div className="flex h-[80vh] items-center justify-center">
                <div className="w-12 h-12 border-4 border-flipkart-blue border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          >
            <RouteTransitionShell>
              <Routes>
              {/* Public Routes */}
              <Route path="/" element={renderRoute(<Home />)} />
              <Route path={FRONTEND_LAUNCH_HUB_PATH} element={renderCriticalRoute(<LaunchHub />)} />
              <Route path={DESKTOP_LOGIN_PATH} element={renderCriticalRoute(<DesktopLogin />)} />
              <Route path="/login" element={renderCriticalRoute(<LoginRoute />)} />
              <Route path="/products" element={renderRoute(<ProductListing />)} />
              <Route path="/category/:category" element={renderRoute(<ProductListing />)} />
              <Route path="/deals" element={renderRoute(<ProductListing />)} />
              <Route path="/trending" element={renderRoute(<ProductListing />)} />
              <Route path="/new-arrivals" element={renderRoute(<ProductListing />)} />
              <Route path="/search" element={renderRoute(<ProductListing />)} />
              <Route path="/product/:id" element={renderRoute(<ProductDetails />)} />
              <Route path="/compare" element={renderRoute(<AICompare />)} />
              <Route path="/visual-search" element={renderRoute(<VisualSearch />)} />
              <Route path="/bundles" element={renderRoute(<Bundles />)} />
              <Route path="/mission-control" element={renderRoute(<MissionControl />)} />
              <Route path="/assistant" element={renderRoute(
                <EmergencyFeatureRoute feature="ai" fallback={<AssistantDisabledNotice />}>
                  <AssistantPage />
                </EmergencyFeatureRoute>
              )} />
              <Route path="/contact" element={renderRoute(<ContactPage />)} />
              {trustRoutes.filter((path) => path !== '/contact').map((path) => (
                <Route key={path} path={path} element={renderRoute(<TrustPage />)} />
              ))}
              <Route path="/trust/:slug" element={renderRoute(<TrustPage />)} />

              {/* Marketplace Routes - Public */}
              <Route path="/marketplace" element={renderRoute(<Marketplace />)} />
              <Route path="/listing/:id" element={renderRoute(<ListingDetail />)} />
              <Route path="/seller/:id" element={renderRoute(<SellerProfile />)} />

              {/* Protected Routes - require authentication */}
              <Route path="/cart" element={renderRoute(<Cart />)} />
              <Route path="/wishlist" element={renderRoute(<Wishlist />)} />
              <Route path="/checkout" element={renderCriticalRoute(<ProtectedRoute><Checkout /></ProtectedRoute>)} />
              <Route path="/orders" element={renderCriticalRoute(<ProtectedRoute><Orders /></ProtectedRoute>)} />
              <Route path="/status" element={renderCriticalRoute(<StatusPage />)} />
              <Route path="/status/history" element={renderCriticalRoute(<StatusHistoryPage />)} />
              <Route path="/status/incidents/:slug" element={renderCriticalRoute(<StatusIncidentDetailPage />)} />
              <Route path="/status/subscribe" element={renderCriticalRoute(<StatusSubscribePage />)} />
              <Route path="/become-seller" element={renderCriticalRoute(<ProtectedRoute><BecomeSeller /></ProtectedRoute>)} />
              <Route path="/sell" element={renderCriticalRoute(<SellerRoute><Sell /></SellerRoute>)} />
              <Route path="/my-listings" element={renderCriticalRoute(<SellerRoute><MyListings /></SellerRoute>)} />
              <Route path="/profile" element={renderCriticalRoute(<ProtectedRoute><ProfilePage /></ProtectedRoute>)} />
              <Route path="/trade-in" element={renderCriticalRoute(<ProtectedRoute><TradeInPage /></ProtectedRoute>)} />
              <Route path="/price-alerts" element={renderCriticalRoute(<ProtectedRoute><PriceAlertsPage /></ProtectedRoute>)} />

              {/* Admin Routes - require admin role */}
              <Route path="/admin/dashboard" element={renderCriticalRoute(<AdminRoute><AdminDashboard /></AdminRoute>)} />
              <Route path="/admin/products" element={renderCriticalRoute(<AdminRoute><ProductList /></AdminRoute>)} />
              <Route path="/admin/product/:id/edit" element={renderCriticalRoute(<AdminRoute><ProductEdit /></AdminRoute>)} />
              <Route path="/admin/orders" element={renderCriticalRoute(<AdminRoute><OrderList /></AdminRoute>)} />
              <Route path="/admin/payments" element={renderCriticalRoute(<AdminRoute><AdminPayments /></AdminRoute>)} />
              <Route path="/admin/refunds" element={renderCriticalRoute(<AdminRoute><AdminRefundLedger /></AdminRoute>)} />
              <Route path="/admin/email-ops" element={renderCriticalRoute(<AdminRoute><AdminEmailOps /></AdminRoute>)} />
              <Route path="/admin/users" element={renderCriticalRoute(<AdminRoute><AdminUsers /></AdminRoute>)} />
              <Route path="/admin/support" element={renderCriticalRoute(<AdminRoute><AdminSupport /></AdminRoute>)} />
              <Route path="/admin/emergency-controls" element={renderCriticalRoute(<AdminRoute><AdminEmergencyControls /></AdminRoute>)} />
              <Route path="/admin/status" element={renderCriticalRoute(<AdminRoute><AdminStatusDashboard /></AdminRoute>)} />
              <Route path="/admin/status/incidents" element={renderCriticalRoute(<AdminRoute><AdminStatusDashboard /></AdminRoute>)} />
              <Route path="/admin/aws-control" element={renderCriticalRoute(<AdminRoute><AdminAwsControl /></AdminRoute>)} />
              </Routes>
            </RouteTransitionShell>
          </Suspense>
        )}
      </main>
      <AppErrorBoundary>
        <AuthCheckpointLayer disabled={Boolean(adminAccessLock)} />
      </AppErrorBoundary>
      {showSiteChrome ? (
        <>
          <AppErrorBoundary>
            <SecurePathDock />
          </AppErrorBoundary>
          {!isNativeMobile ? (
            <AppErrorBoundary>
              <Footer />
            </AppErrorBoundary>
          ) : null}
        </>
      ) : null}
      {showSiteChrome ? (
        <AppErrorBoundary>
          <MobileNativeTabBar />
        </AppErrorBoundary>
      ) : null}
      <Toaster
        richColors
        position={isNativeMobile ? 'top-center' : 'top-right'}
        toastOptions={{
          className: 'border border-white/10 bg-zinc-900 text-slate-100',
        }}
      />
      {showSiteChrome ? (
        <>
          <DesktopWelcomePanel />
          <DesktopUpdateBanner />
          <MobileUpdateBanner />
        </>
      ) : null}
    </div>
  );
}

import { VideoCallProvider } from './context/VideoCallContext';

import { StableText } from '@/i18n/StableText';
function App() {
  return (
    <ColorModeProvider>
      <MotionModeProvider>
        <MarketProvider>
          <LocaleProvider>
            <EmergencyStatusProvider>
              <AuthProvider>
                <SocketProvider>
                  <NotificationProvider>
                    <VideoCallProvider>
                      <CommerceProvider>
                        {/* React Router v7 defaults BrowserRouter navigations to startTransition,
                            which can leave the previous lazy route visible after URL changes. */}
                        <Router unstable_useTransitions={false}>
                          <MultimodalAssistantProvider>
                            <AppContent />
                          </MultimodalAssistantProvider>
                        </Router>
                      </CommerceProvider>
                    </VideoCallProvider>
                  </NotificationProvider>
                </SocketProvider>
              </AuthProvider>
            </EmergencyStatusProvider>
          </LocaleProvider>
        </MarketProvider>
      </MotionModeProvider>
    </ColorModeProvider>
  );
}

export default App;
