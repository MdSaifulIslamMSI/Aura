import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/figmaTokens.css'
import './index.css'
import App from './App.jsx'
import { ErrorBoundary } from 'react-error-boundary';
import { initClientObservability } from './services/clientObservability'
import { publishReleaseInfo } from './config/releaseInfo'

function RootRenderFallback({ error, resetErrorBoundary }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-lg rounded-3xl border border-neo-rose/35 bg-zinc-950/90 p-6 text-center shadow-glass">
        <h1 className="text-2xl font-black tracking-tight text-white">Aura failed to boot</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          A startup module crashed before the interface finished loading. Retry the render or refresh the page to recover.
        </p>
        {error?.message ? (
          <p className="mt-3 text-xs font-medium text-neo-cyan/90">{error.message}</p>
        ) : null}
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={resetErrorBoundary}
            className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/15"
          >
            Retry Render
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-neo-cyan/45 bg-neo-cyan/15 px-4 py-2 text-sm font-semibold text-neo-cyan transition-colors hover:bg-neo-cyan/20"
          >
            Refresh Page
          </button>
        </div>
      </div>
    </div>
  );
}

const clearServiceWorkerState = async () => {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
  } catch {}

  try {
    if ('caches' in window) {
      const cacheKeys = await caches.keys()
      await Promise.all(cacheKeys.map((key) => caches.delete(key)))
    }
  } catch {}
}

const registerAuraServiceWorker = () => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }

  window.addEventListener('load', () => {
    if (!import.meta.env.PROD || shouldDisableServiceWorkerForRuntime()) {
      void clearServiceWorkerState()
      return
    }

    void navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, { once: true })
}

const isElectronRuntime = () => (
  typeof navigator !== 'undefined'
  && /electron/i.test(String(navigator.userAgent || ''))
)

const isLoopbackRuntime = () => {
  if (typeof window === 'undefined') return false
  const hostname = String(window.location.hostname || '').toLowerCase()
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

const isDesktopAuthRuntimeRoute = () => {
  if (typeof window === 'undefined') return false
  const pathname = String(window.location.pathname || '/')
  const params = new URLSearchParams(window.location.search || '')
  return pathname === '/desktop-login'
    || (
      pathname === '/login'
      && (
        params.has('desktopAuthRequest')
        || params.has('desktopAuthSecret')
        || params.has('desktopAuthCallback')
        || params.has('desktopAuthReturnTo')
      )
    )
}

const shouldDisableServiceWorkerForRuntime = () => {
  return isElectronRuntime() || isLoopbackRuntime() || isDesktopAuthRuntimeRoute()
}

// Firebase OAuth domain safety:
// If app is opened via 127.0.0.1, force localhost to match common authorized-domain setup.
if (typeof window !== 'undefined' && window.location.hostname === '127.0.0.1' && !isElectronRuntime()) {
  const normalized = new URL(window.location.href)
  normalized.hostname = 'localhost'
  window.location.replace(normalized.toString())
}

registerAuraServiceWorker()
initClientObservability()
publishReleaseInfo()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary FallbackComponent={RootRenderFallback}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
