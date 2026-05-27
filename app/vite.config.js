import { execSync } from "node:child_process"
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

const DEFERRED_ROUTE_PRELOAD_PATTERNS = [
  /^assets\/admin-/,
  /^assets\/commerce-flow-/,
  /^assets\/market-locale-/,
  /^assets\/discovery-/,
  /^assets\/market-messages-/,
  /^assets\/marketplace-/,
  /^assets\/product-experience-/,
]

const ADMIN_CHUNK_MATCHERS = [
  { pattern: /\/src\/pages\/Admin\/Dashboard\.jsx$/, chunk: 'admin-dashboard' },
  { pattern: /\/src\/pages\/Admin\/ClientDiagnosticsPanel\.jsx$/, chunk: 'admin-diagnostics' },
  { pattern: /\/src\/pages\/Admin\/Support\.jsx$/, chunk: 'admin-support' },
  { pattern: /\/src\/pages\/Admin\/ProductList\.jsx$/, chunk: 'admin-products' },
  { pattern: /\/src\/pages\/Admin\/ProductEdit\.jsx$/, chunk: 'admin-product-edit' },
  { pattern: /\/src\/pages\/Admin\/OrderList\.jsx$/, chunk: 'admin-orders' },
  { pattern: /\/src\/pages\/Admin\/Payments\.jsx$/, chunk: 'admin-payments' },
  { pattern: /\/src\/pages\/Admin\/Users\.jsx$/, chunk: 'admin-users' },
  { pattern: /\/src\/pages\/Admin\/RefundLedger\.jsx$/, chunk: 'admin-refunds' },
  { pattern: /\/src\/pages\/Admin\/EmailOps\.jsx$/, chunk: 'admin-email-ops' },
  { pattern: /\/src\/pages\/Admin\/StatusDashboard\.jsx$/, chunk: 'admin-status' },
]

const INTERNAL_CHUNK_MATCHERS = [
  { pattern: /\/src\/config\/generatedMarketMessages\.js$/, chunk: 'market-messages-base' },
  { pattern: /\/src\/config\/priorityMarketMessages\.js$/, chunk: 'market-messages-priority' },
  { pattern: /\/src\/config\/generatedLocaleMessages\.js$/, chunk: 'market-messages-locales' },
  { pattern: /\/src\/config\/generatedDynamicLocaleMessages\.js$/, chunk: 'market-messages-dynamic' },
  { pattern: /\/src\/config\/remainingUiLocaleMessages\.js$/, chunk: 'market-messages-ui' },
  { pattern: /\/src\/config\/localePolishMessages\.js$/, chunk: 'market-messages-polish' },
]

const trimValue = (value = '') => (typeof value === 'string' ? value.trim() : '')

const firstNonEmptyValue = (...values) => values.map(trimValue).find(Boolean) || ''

const safeExec = (command) => {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

const gitCommitSha = firstNonEmptyValue(
  process.env.VITE_RELEASE_SHA,
  process.env.GITHUB_SHA,
  safeExec('git rev-parse HEAD')
)

const shortCommitSha = gitCommitSha ? gitCommitSha.slice(0, 8) : ''

const releaseTarget = firstNonEmptyValue(
  process.env.VITE_DEPLOY_TARGET,
  process.env.DEPLOY_TARGET,
  process.env.VERCEL === '1' ? 'vercel' : '',
  process.env.NETLIFY === 'true' ? 'netlify' : '',
  process.env.CI ? 'ci' : 'local'
)

const releaseChannel = firstNonEmptyValue(
  process.env.VITE_RELEASE_CHANNEL,
  process.env.GITHUB_REF_NAME,
  process.env.NODE_ENV,
  'local'
)

const releaseSource = firstNonEmptyValue(
  process.env.VITE_RELEASE_SOURCE,
  process.env.GITHUB_ACTIONS ? 'github-actions' : '',
  process.env.CI ? 'ci' : '',
  'local'
)

const releaseInfo = Object.freeze({
  id: firstNonEmptyValue(
    process.env.VITE_RELEASE_ID,
    shortCommitSha ? `git-${shortCommitSha}` : '',
    `${releaseTarget}-unversioned`
  ),
  commitSha: gitCommitSha || 'unknown',
  shortCommitSha: shortCommitSha || 'unknown',
  deployTarget: releaseTarget,
  channel: releaseChannel,
  source: releaseSource,
  builtAt: firstNonEmptyValue(process.env.VITE_RELEASE_TIME, new Date().toISOString()),
})

const auraReleaseMetaPlugin = {
  name: 'aura-release-meta',
  transformIndexHtml() {
    return [
      { tag: 'meta', attrs: { name: 'aura-release-id', content: releaseInfo.id }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'aura-release-commit', content: releaseInfo.shortCommitSha }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'aura-release-target', content: releaseInfo.deployTarget }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'aura-release-channel', content: releaseInfo.channel }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'aura-release-built-at', content: releaseInfo.builtAt }, injectTo: 'head' },
    ]
  },
}

const resolveDevApiProxyTarget = (mode) => {
  const env = loadEnv(mode, process.cwd(), '')
  const rawTarget = firstNonEmptyValue(
    env.VITE_DEV_API_PROXY_TARGET,
    env.VITE_API_URL,
    process.env.VITE_DEV_API_PROXY_TARGET,
    process.env.VITE_API_URL,
    'http://127.0.0.1:5000/api'
  )

  try {
    const url = new URL(rawTarget)
    url.pathname = trimValue(url.pathname).replace(/\/api\/?$/i, '') || '/'
    url.search = ''
    url.hash = ''
    return trimValue(url.toString()).replace(/\/+$/, '')
  } catch {
    return 'http://127.0.0.1:5000'
  }
}

const createProxyConfig = (target) => ({
  target,
  changeOrigin: true,
  secure: false,
})

const DEV_SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; script-src 'self' https://apis.google.com https://accounts.google.com https://checkout.razorpay.com https://js.stripe.com https://www.google.com https://www.gstatic.com https://www.recaptcha.net https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: https:; connect-src 'self' https://dbtrhsolhec1s.cloudfront.net wss://dbtrhsolhec1s.cloudfront.net http://localhost:* http://127.0.0.1:* http://host.docker.internal:* https://api.github.com https://api.stripe.com https://js.stripe.com https://hooks.stripe.com https://checkout.razorpay.com https://api.razorpay.com https://*.razorpay.com https://*.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://firebaseinstallations.googleapis.com https://firebaselogging.googleapis.com https://www.google.com https://www.gstatic.com https://www.recaptcha.net https://challenges.cloudflare.com https://*.firebaseio.com https://*.firebaseapp.com https://*.web.app https://*.livekit.cloud wss://*.livekit.cloud; frame-src 'self' https://accounts.google.com https://checkout.razorpay.com https://js.stripe.com https://hooks.stripe.com https://www.google.com https://www.recaptcha.net https://challenges.cloudflare.com https://*.firebaseapp.com https://*.web.app https://app.powerbi.com; worker-src 'self' blob:; manifest-src 'self'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=(self), usb=(), serial=(), bluetooth=()',
  'Cache-Control': 'no-store',
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const devApiProxyTarget = resolveDevApiProxyTarget(mode)

  return {
  base: '/',
  define: {
    __AURA_RELEASE__: JSON.stringify(releaseInfo),
  },
  build: {
    modulePreload: {
      resolveDependencies(_filename, deps) {
        return deps.filter((dependency) => !DEFERRED_ROUTE_PRELOAD_PATTERNS.some((pattern) => pattern.test(dependency)));
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react') || id.includes('/node_modules/react-dom') || id.includes('/node_modules/scheduler')) {
            return 'vendor-react';
          }
          if (id.includes('/node_modules/react-router')) return 'vendor-router';
          if (id.includes('/node_modules/lucide-react')) return 'vendor-icons';
          if (id.includes('/node_modules/sonner')) return 'vendor-toasts';
          if (id.includes('/node_modules/firebase')) return 'vendor-firebase';
          if (id.includes('/node_modules/framer-motion')) return 'vendor-motion';
          if (id.includes('/node_modules/livekit-client')) return 'vendor-livekit';
          if (id.includes('/node_modules/react-markdown') || id.includes('/node_modules/remark-gfm')) return 'vendor-markdown';
          if (id.includes('/node_modules/@radix-ui')) return 'vendor-radix';

          const matchedInternalChunk = INTERNAL_CHUNK_MATCHERS.find(({ pattern }) => pattern.test(id));
          if (matchedInternalChunk) return matchedInternalChunk.chunk;

          const localePackMatch = id.match(/\/src\/config\/marketMessagePacks\/([a-z-]+)\.js$/);
          if (localePackMatch?.[1]) return `market-locale-${localePackMatch[1]}`;

          const matchedAdminChunk = ADMIN_CHUNK_MATCHERS.find(({ pattern }) => pattern.test(id));
          if (matchedAdminChunk) return matchedAdminChunk.chunk;
          if (id.includes('/src/pages/Marketplace/') || id.includes('/src/pages/Listing') || id.includes('/src/components/features/marketplace/')) {
            return 'marketplace';
          }
          if (id.includes('/src/pages/Checkout/') || id.includes('/src/pages/Orders/')) return 'commerce-flow';
          if (id.includes('/src/pages/Product') || id.includes('/src/components/features/product/')) return 'product-experience';
          if (id.includes('/src/components/shared/GlobalSearchBar') || id.includes('/src/utils/recommendationSignals')) return 'discovery';
        },
      },
    },
  },
  server: {
    allowedHosts: ['host.docker.internal'],
    headers: DEV_SECURITY_HEADERS,
    proxy: {
      '/api': createProxyConfig(devApiProxyTarget),
      '/health': createProxyConfig(devApiProxyTarget),
      '/uploads': createProxyConfig(devApiProxyTarget),
    },
  },
  plugins: [react(), auraReleaseMetaPlugin],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  }
})
