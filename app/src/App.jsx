import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { WishlistProvider } from './context/WishlistContext';
import { ProductProvider } from './context/ProductContext';
import { ColorModeProvider } from './context/ColorModeContext';
import { MotionModeProvider, useMotionMode } from './context/MotionModeContext';
import { SocketProvider } from './context/SocketContext';
import { AdminRoute, ProtectedRoute, SellerRoute } from './components/shared/ProtectedRoute';
import { NotificationProvider } from './context/NotificationContext';

import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import ScrollToTop from './components/shared/ScrollToTop';
import SmoothScrollManager from './components/shared/SmoothScrollManager';
import ScrollProgressBar from './components/shared/ScrollProgressBar';
import SectionAnchorRail from './components/shared/SectionAnchorRail';
import RouteTransitionShell from './components/shared/RouteTransitionShell';
import AppErrorBoundary from './components/shared/AppErrorBoundary';
import BackendStatusBanner from './components/shared/BackendStatusBanner';
import { trustRoutes } from './config/trustContent';
import { assertRouteA11yContracts } from './utils/a11yContracts';

// Pages (Lazy Loaded for Performance)
const Home = lazy(() => import('./pages/Home'));
const Login = lazy(() => import('./pages/Login'));
const ProductListing = lazy(() => import('./pages/ProductListing'));
const ProductDetails = lazy(() => import('./pages/ProductDetails'));
const Cart = lazy(() => import('./pages/Cart'));
const Wishlist = lazy(() => import('./pages/Wishlist'));
const Checkout = lazy(() => import('./pages/Checkout'));
const Orders = lazy(() => import('./pages/Orders'));

// Admin Pages
const AdminDashboard = lazy(() => import('./pages/Admin/Dashboard'));
const ProductList = lazy(() => import('./pages/Admin/ProductList'));
const ProductEdit = lazy(() => import('./pages/Admin/ProductEdit'));
const OrderList = lazy(() => import('./pages/Admin/OrderList'));
const AdminPayments = lazy(() => import('./pages/Admin/Payments'));
const AdminUsers = lazy(() => import('./pages/Admin/Users'));
const AdminRefundLedger = lazy(() => import('./pages/Admin/RefundLedger'));
const AdminSupport = lazy(() => import('./pages/Admin/Support'));

// Marketplace Pages
const Sell = lazy(() => import('./pages/Sell'));
const Marketplace = lazy(() => import('./pages/Marketplace'));
const ListingDetail = lazy(() => import('./pages/ListingDetail'));
const SellerProfile = lazy(() => import('./pages/SellerProfile'));
const MyListings = lazy(() => import('./pages/MyListings'));
const ProfilePage = lazy(() => import('./pages/Profile'));
const TradeInPage = lazy(() => import('./pages/TradeIn'));
const PriceAlertsPage = lazy(() => import('./pages/PriceAlerts'));
const BecomeSeller = lazy(() => import('./pages/BecomeSeller'));
const TrustPage = lazy(() => import('./pages/Trust'));
const AICompare = lazy(() => import('./pages/AICompare'));
const VisualSearch = lazy(() => import('./pages/VisualSearch'));
const Bundles = lazy(() => import('./pages/Bundles'));
const MissionControl = lazy(() => import('./pages/MissionControl'));
const ChatBot = lazy(() => import('./components/features/chat/ChatBot'));

const AMBIENT_CHROME_PREFIXES = [
  '/',
  '/products',
  '/category/',
  '/search',
  '/deals',
  '/trending',
  '/new-arrivals',
  '/marketplace',
  '/product/',
  '/listing/',
  '/seller/',
  '/compare',
  '/visual-search',
  '/bundles',
  '/mission-control',
  '/trust',
];

const CHATBOT_PREFIXES = [
  '/',
  '/products',
  '/category/',
  '/search',
  '/deals',
  '/trending',
  '/new-arrivals',
  '/marketplace',
  '/product/',
  '/listing/',
  '/seller/',
  '/compare',
  '/visual-search',
  '/bundles',
];

const routeMatches = (pathname, prefixes) => {
  if (pathname === '/') return prefixes.includes('/');
  return prefixes.some((prefix) => prefix !== '/' && pathname.startsWith(prefix));
};

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
  const [chatBotReady, setChatBotReady] = useState(false);

  const showAmbientChrome = useMemo(
    () => !pathname.startsWith('/admin') && routeMatches(pathname, AMBIENT_CHROME_PREFIXES),
    [pathname]
  );
  const showAnchorRail = showAmbientChrome && effectiveMotionMode === 'cinematic';
  const showChatBot = useMemo(
    () => !pathname.startsWith('/admin') && routeMatches(pathname, CHATBOT_PREFIXES),
    [pathname]
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
    if (typeof window === 'undefined' || !showChatBot || chatBotReady) return undefined;

    let cancelled = false;
    let timeoutId = 0;
    let idleId = 0;

    const activate = () => {
      if (!cancelled) {
        setChatBotReady(true);
      }
    };

    timeoutId = window.setTimeout(activate, 1400);

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(activate, { timeout: 1800 });
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
  }, [chatBotReady, pathname, showChatBot]);

  return (
    <div className="aura-app-shell flex min-h-screen flex-col">
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
      <AppErrorBoundary>
        <Navbar />
      </AppErrorBoundary>
      <AppErrorBoundary>
        <BackendStatusBanner />
      </AppErrorBoundary>
      <main id="main-content" className="relative z-10 flex-1" role="main" aria-label="Main content">
        <Suspense
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
              {trustRoutes.map((path) => (
                <Route key={path} path={path} element={renderRoute(<TrustPage />)} />
              ))}
              <Route path="/trust/:slug" element={renderRoute(<TrustPage />)} />

              {/* Marketplace Routes - Public */}
              <Route path="/marketplace" element={renderRoute(<Marketplace />)} />
              <Route path="/listing/:id" element={renderRoute(<ListingDetail />)} />
              <Route path="/seller/:id" element={renderRoute(<SellerProfile />)} />

              {/* Protected Routes - require authentication */}
              <Route path="/cart" element={renderCriticalRoute(<ProtectedRoute><Cart /></ProtectedRoute>)} />
              <Route path="/wishlist" element={renderCriticalRoute(<ProtectedRoute><Wishlist /></ProtectedRoute>)} />
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
              <Route path="/admin/users" element={renderCriticalRoute(<AdminRoute><AdminUsers /></AdminRoute>)} />
              <Route path="/admin/support" element={renderCriticalRoute(<AdminRoute><AdminSupport /></AdminRoute>)} />
            </Routes>
          </RouteTransitionShell>
        </Suspense>
      </main>
      {showChatBot && chatBotReady ? (
        <Suspense fallback={null}>
          <AppErrorBoundary>
            <ChatBot />
          </AppErrorBoundary>
        </Suspense>
      ) : null}
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
          <AuthProvider>
            <SocketProvider>
              <VideoCallProvider>
                <CartProvider>
                  <WishlistProvider>
                    <ProductProvider>
                      <Router>
                        <AppContent />
                      </Router>
                    </ProductProvider>
                  </WishlistProvider>
                </CartProvider>
              </VideoCallProvider>
            </SocketProvider>
          </AuthProvider>
      </MotionModeProvider>
    </ColorModeProvider>
  );
}

export default App;
