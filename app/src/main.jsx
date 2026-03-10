import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/figmaTokens.css'
import './index.css'
import App from './App.jsx'
import { HelmetProvider } from 'react-helmet-async';
import { ErrorBoundary } from 'react-error-boundary';
import { AuthProvider } from './context/AuthContext.jsx';
import { ColorModeProvider } from './context/ColorModeContext.jsx';
import { CartProvider } from './context/CartContext.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import AppErrorBoundary from './components/shared/AppErrorBoundary.jsx';
import { Toaster } from 'react-hot-toast';
import { initClientObservability } from './services/clientObservability'

// Firebase OAuth domain safety:
// If app is opened via 127.0.0.1, force localhost to match common authorized-domain setup.
if (typeof window !== 'undefined' && window.location.hostname === '127.0.0.1') {
  const normalized = new URL(window.location.href)
  normalized.hostname = 'localhost'
  window.location.replace(normalized.toString())
}

initClientObservability()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HelmetProvider>
      <ErrorBoundary FallbackComponent={AppErrorBoundary}>
        <ColorModeProvider>
          <AuthProvider>
            <SocketProvider>
              <CartProvider>
                <App />
                <Toaster
                  position="bottom-right"
                  toastOptions={{
                    duration: 4000,
                    style: {
                      background: 'var(--bg-card)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                    },
                  }}
                />
              </CartProvider>
            </SocketProvider>
          </AuthProvider>
        </ColorModeProvider>
      </ErrorBoundary>
    </HelmetProvider>
  </StrictMode>,
)
