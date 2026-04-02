import { Suspense, useEffect, useMemo, useState } from 'react';
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './context/AuthContext';
import { CommerceProvider } from './context/CommerceContext';
import { ColorModeProvider } from './context/ColorModeContext';
import { MarketProvider } from './context/MarketContext';
import { MotionModeProvider, useMotionMode } from './context/MotionModeContext';
import { SocketProvider } from './context/SocketContext';
import { AdminRoute, ProtectedRoute, SellerRoute } from './components/shared/ProtectedRoute';
import { NotificationProvider } from './context/NotificationContext';

import Navbar, { NavbarFailureFallback } from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import ScrollToTop from './components/shared/ScrollToTop';
import SmoothScrollManager from './components/shared/SmoothScrollManager';
import ScrollProgressBar from './components/shared/ScrollProgressBar';
import SectionAnchorRail from './components/shared/SectionAnchorRail';
import RouteTransitionShell from './components/shared/RouteTransitionShell';
import AppErrorBoundary from './components/shared/AppErrorBoundary';
import BackendStatusBanner from './components/shared/BackendStatusBanner';
import GlobalSupportLauncher from './components/shared/GlobalSupportLauncher';
import AuraTrustedDeviceChallenge from './components/features/auth/AuraTrustedDeviceChallenge';
import { trustRoutes } from './config/trustContent';
import { assertRouteA11yContracts } from './utils/a11yContracts';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { MultimodalAssistantProvider } from './context/MultimodalAssistantContext';
import { isAssistantV2Enabled } from './services/assistantFeatureFlags';
import {
  shouldShowAmbientChrome,
  shouldShowAssistantLauncher,
  shouldShowLegacyChatBot,
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
const ChatBot = lazyWithRetry(() => import('./components/features/chat/ChatBot'), 'chat-bot');
const AssistantLauncher = lazyWithRetry(() => import('./components/shared/AssistantLauncher'), 'assistant-launcher');

function renderRoute(element) {
  return <AppErrorBoundary>{element}</AppErrorBoundary>;
}

function renderCriticalRoute(element) {
  return element;
}

function AppContent() {
  const location = useLocation();
  const { effectiveMotionMode } = useMotionMode();
  const pathname = location.pathname;
  const routeRenderKey = `${location.pathname}${location.search}${location.hash}`;
  const [chatBotReady, setChatBotReady] = useState(false);
  const assistantV2Enabled = isAssistantV2Enabled();

  const showAmbientChrome = useMemo(
    () => shouldShowAmbientChrome(pathname),
    [pathname]
  );
  const showAnchorRail = showAmbientChrome && effectiveMotionMode === 'cinematic';
  const showLegacyChatBot = useMemo(
    () => shouldShowLegacyChatBot({ pathname, assistantV2Enabled }),
    [assistantV2Enabled, pathname]
  );
  const showAssistantLauncher = useMemo(
    () => shouldShowAssistantLauncher({ pathname, assistantV2Enabled }),
    [assistantV2Enabled, pathname]
  );


  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') {
      return undefined;
    }

    const rafId = window.requestAnimationFrame(() => {
      assertRouteA11yContracts(pathname);
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [pathname]);

  useEffect(() => {
    if (typeof window === 'undefined' || !showLegacyChatBot || chatBotReady) return undefined;

    let cancelled = false;
    let timeoutId = 0;
    let idleId = 0;

    const activate = () => {
      if (!cancelled) {
        setChatBotReady(true);
      }
    };

    void import('./components/features/chat/ChatBot').catch(() => {});

    timeoutId = window.setTimeout(activate, 420);

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(activate, { timeout: 650 });
    }

    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      if (idleId && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [chatBotReady, pathname, showLegacyChatBot]);

  return (
    <div className="aura-app-shell flex min-h-screen min-w-0 flex-col overflow-x-hidden">
      {/* Skip-to-main-content — first focusable element for keyboard/screen-reader users.
          Hidden by default, revealed on focus via sr-only + focus:not-sr-only pattern. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[9999] focus:rounded-lg focus:bg-neo-cyan focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-zinc-950 focus:shadow-lg"
      >
        Skip to main content
      </a>
      <SmoothScrollManager />
      <ScrollToTop />
      {showAmbientChrome ? <ScrollProgressBar /> : null}
      {showAnchorRail ? <SectionAnchorRail /> : null}
      <AppErrorBoundary fallback={<NavbarFailureFallback />}>
        <Navbar />
      </AppErrorBoundary>
      <AppErrorBoundary>
        <BackendStatusBanner />
      </AppErrorBoundary>
      <main id="main-content" className="relative z-10 flex-1 min-w-0 overflow-x-hidden" role="main" aria-label="Main content">
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
              <Route path="/login" element={renderCriticalRoute(<Login />)} />
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
              <Route path="/assistant" element={renderRoute(<AssistantPage />)} />
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
            </Routes>
          </RouteTransitionShell>
        </Suspense>
      </main>
      {showLegacyChatBot && chatBotReady ? (
        <Suspense fallback={null}>
          <AppErrorBoundary>
            <ChatBot />
          </AppErrorBoundary>
        </Suspense>
      ) : null}
      {showAssistantLauncher ? (
        <Suspense fallback={null}>
          <AppErrorBoundary>
            <AssistantLauncher />
          </AppErrorBoundary>
        </Suspense>
      ) : null}
      <AppErrorBoundary>
        <GlobalSupportLauncher />
      </AppErrorBoundary>
      <AppErrorBoundary>
        <AuraTrustedDeviceChallenge />
      </AppErrorBoundary>
      <AppErrorBoundary>
        <Footer />
      </AppErrorBoundary>
      <Toaster
        richColors
        position="top-right"
        toastOptions={{
          className: 'border border-white/10 bg-zinc-900 text-slate-100',
        }}
      />
    </div>
  );
}

import { VideoCallProvider } from './context/VideoCallContext';

function App() {
  return (
    <ColorModeProvider>
      <MotionModeProvider>
        <MarketProvider>
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
        </MarketProvider>
      </MotionModeProvider>
    </ColorModeProvider>
  );
}

export default App;
