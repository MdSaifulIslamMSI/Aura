import { execSync } from "node:child_process"
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

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
  { pattern: /\/src\/pages\/Admin\/ClientDiagnosticsPanel\.jsx$/, chunk: 'admin-dashboard' },
  { pattern: /\/src\/pages\/Admin\/Support\.jsx$/, chunk: 'admin-support' },
  { pattern: /\/src\/pages\/Admin\/ProductList\.jsx$/, chunk: 'admin-products' },
  { pattern: /\/src\/pages\/Admin\/ProductEdit\.jsx$/, chunk: 'admin-product-edit' },
  { pattern: /\/src\/pages\/Admin\/OrderList\.jsx$/, chunk: 'admin-orders' },
  { pattern: /\/src\/pages\/Admin\/Payments\.jsx$/, chunk: 'admin-payments' },
  { pattern: /\/src\/pages\/Admin\/Users\.jsx$/, chunk: 'admin-users' },
  { pattern: /\/src\/pages\/Admin\/RefundLedger\.jsx$/, chunk: 'admin-refunds' },
  { pattern: /\/src\/pages\/Admin\/EmailOps\.jsx$/, chunk: 'admin-email-ops' },
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

// https://vite.dev/config/
export default defineConfig({
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
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
      },
      '/health': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  plugins: [react(), auraReleaseMetaPlugin],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
