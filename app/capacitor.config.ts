/// <reference types="@capacitor-firebase/authentication" />

import type { CapacitorConfig } from '@capacitor/cli';

const hostedMobileUrl = process.env.AURA_MOBILE_HOSTED_URL || 'https://aurapilot.vercel.app';

const config: CapacitorConfig = {
  appId: 'com.aura.marketplace.mobile',
  appName: 'Aura Marketplace',
  webDir: 'dist',
  server: {
    url: hostedMobileUrl,
    cleartext: false,
    allowNavigation: [
      'aurapilot.vercel.app',
      'aurapilot.netlify.app',
      'aura-gateway.vercel.app',
      'accounts.google.com',
      'google.com',
      'www.google.com',
      'facebook.com',
      'www.facebook.com',
      'm.facebook.com',
      'mobile.facebook.com',
      'x.com',
      'www.x.com',
      'twitter.com',
      'api.twitter.com',
      'oauth.twitter.com',
      'billy-b674c.firebaseapp.com',
      'billy-b674c.web.app',
    ],
  },
  plugins: {
    FirebaseAuthentication: {
      authDomain: 'billy-b674c.firebaseapp.com',
      skipNativeAuth: false,
      providers: ['google.com', 'facebook.com', 'twitter.com'],
    },
    SplashScreen: {
      launchShowDuration: 1400,
      backgroundColor: '#030712',
      showSpinner: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#030712',
    },
  },
};

export default config;
