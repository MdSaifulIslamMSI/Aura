# Platform Availability

Aura is available through the strongest runtime each platform can realistically support.

## Full App Surfaces

- Web/PWA: Vercel, Netlify, and AWS CloudFront serve the same production storefront.
- Desktop: Windows, macOS, and Linux packages ship through the desktop release lane.
- Mobile: Android APK/AAB and iOS/iPadOS IPA artifacts ship through the mobile release lane when signing assets allow it.

## Requested Platform Coverage

| Platform | Aura surface | Notes |
| --- | --- | --- |
| iPadOS | PWA today, signed IPA when Apple signing is configured | Safari users can add Aura to the Home Screen. A real-device IPA still requires Apple signing and provisioning. |
| ChromeOS | PWA today, Android APK on compatible devices | ChromeOS users should install the hosted PWA from Chrome. APK testing depends on Chromebook Android compatibility. |
| Ubuntu | Native Linux deb, AppImage, hosted PWA | Ubuntu users should choose the deb package for normal installs or AppImage for portable use. |
| Fedora | Native Linux RPM, AppImage, hosted PWA | Fedora users should choose the RPM package for normal installs or AppImage for portable use. |
| Unix / BSD | Hosted PWA in a modern browser | Linux has native desktop packages. BSD and illumos-style systems should use the browser/PWA lane unless a separate native build target is added later. |
| HarmonyOS | Hosted PWA today, APK testing on Android-compatible devices | A native HarmonyOS HAP package needs a separate HarmonyOS project and Huawei signing pipeline. |
| FreeRTOS / RTOS family | Companion/client integration only | RTOS devices cannot run the full React marketplace UI. They can call Aura backend APIs or communicate through an HTTPS/MQTT bridge for device status, telemetry, inventory signals, and lightweight commerce events. |

## PWA Behavior

- The manifest is tablet and desktop friendly, with standalone display, broad orientation support, app shortcuts, and install metadata.
- The service worker is intentionally network-first for navigations so new deployments take priority over cached HTML.
- Static hashed assets can be cached for repeat launches.
- API, realtime, and upload routes are not cached by the service worker.

## RTOS Boundary

Keep account login, checkout, payment, and admin workflows on web, desktop, or mobile. RTOS firmware should only send or receive scoped operational signals through authenticated backend endpoints or a gateway bridge.
