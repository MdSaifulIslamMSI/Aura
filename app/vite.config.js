import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('firebase')) return 'firebase';
            if (id.includes('lucide-react')) return 'icons';
            if (id.includes('recharts')) return 'charts';
            if (id.includes('@radix-ui') || id.includes('cmdk') || id.includes('vaul')) return 'ui-kit';
            if (id.includes('react') || id.includes('scheduler')) return 'react-core';
            return 'vendor';
          }

          if (id.includes('/src/pages/Admin/')) return 'admin-pages';
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
