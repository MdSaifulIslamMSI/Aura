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

const matchesNodeModule = (id, packageNames = []) => packageNames.some((packageName) => (
  id.includes(`/node_modules/${packageName}`)
  || id.includes(`\\node_modules\\${packageName}`)
))

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  build: {
    modulePreload: {
      resolveDependencies(_filename, deps) {
        return deps.filter((dependency) => !DEFERRED_ROUTE_PRELOAD_PATTERNS.some((pattern) => pattern.test(dependency)));
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (matchesNodeModule(id, ['react', 'react-dom', 'scheduler'])) return 'react-core'
            if (matchesNodeModule(id, ['react-router', 'react-router-dom'])) return 'react-router'
            if (id.includes('firebase')) return 'firebase';
            if (id.includes('lucide-react')) return 'icons';
            if (id.includes('recharts')) return 'charts';
            if (id.includes('@radix-ui') || id.includes('cmdk') || id.includes('vaul')) return 'ui-kit';
            if (
              matchesNodeModule(id, [
                'framer-motion',
                'motion-dom',
                'motion-utils',
                'lenis',
              ])
            ) return 'motion'
            if (
              matchesNodeModule(id, [
                'socket.io-client',
                'socket.io-parser',
                'engine.io-client',
                'engine.io-parser',
                '@socket.io',
                'livekit-client',
              ])
            ) return 'realtime'
            if (
              matchesNodeModule(id, [
                'react-markdown',
                'remark-gfm',
                'remark-parse',
                'remark-rehype',
                'rehype-raw',
                'rehype-stringify',
                'unified',
                'bail',
                'trough',
                'vfile',
                'vfile-message',
                'mdast-util-from-markdown',
                'mdast-util-gfm',
                'mdast-util-gfm-autolink-literal',
                'mdast-util-gfm-footnote',
                'mdast-util-gfm-strikethrough',
                'mdast-util-gfm-table',
                'mdast-util-gfm-task-list-item',
                'mdast-util-to-hast',
                'micromark',
                'micromark-core-commonmark',
                'micromark-extension-gfm',
                'micromark-extension-gfm-autolink-literal',
                'micromark-extension-gfm-footnote',
                'micromark-extension-gfm-strikethrough',
                'micromark-extension-gfm-table',
                'micromark-extension-gfm-tagfilter',
                'micromark-extension-gfm-task-list-item',
                'hast-util-',
                'unist-util-',
                'decode-named-character-reference',
                'property-information',
                'space-separated-tokens',
                'comma-separated-tokens',
              ])
            ) return 'markdown'
            
            return 'vendor';
          }

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
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
