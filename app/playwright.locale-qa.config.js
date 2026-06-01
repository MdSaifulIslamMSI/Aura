import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const previewHost = '127.0.0.1';
const previewPort = '4173';
const previewBaseUrl = `http://localhost:${previewPort}`;
const appDir = fileURLToPath(new URL('.', import.meta.url));
const chromiumChannel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: previewBaseUrl,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: chromiumChannel },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'], channel: chromiumChannel },
    },
  ],
  webServer: {
    command: `npm run build -- --mode test && npm run preview -- --host ${previewHost} --port ${previewPort}`,
    cwd: appDir,
    url: previewBaseUrl,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_ENABLE_BACKEND_STATUS_BANNER: 'false',
      VITE_FIREBASE_MEASUREMENT_ID: '',
      VITE_API_URL: process.env.VITE_API_URL || 'http://127.0.0.1:5999/api',
      VITE_I18N_FORMATJS_ENABLED: 'true',
      VITE_I18N_PSEUDO_LOCALE_ENABLED: 'true',
      VITE_I18N_RUNTIME_TRANSLATION_ENABLED: 'false',
    },
  },
});
