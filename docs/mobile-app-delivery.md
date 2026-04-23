# Mobile App Delivery

Aura Marketplace now ships as Capacitor-based Android and iOS shells on top of the hosted production storefront.

## Delivery shape
- Android and iOS apps load the production Aura frontend from `https://aurapilot.vercel.app`.
- The native shells exist for installability, native auth support, app-icon presence, and store-ready packaging.
- Most product/UI changes arrive through the normal frontend deploy, so the mobile binaries do not need to be rebuilt for every web-only change.
- The public download surface is `https://aura-gateway.vercel.app/`, backed by the dedicated Vercel project `aura-gateway`.

## Native auth lane
- Web and desktop continue to use the existing Firebase web auth flow.
- Android and iPhone use the Capacitor Firebase Authentication bridge for native social sign-in.
- Trusted-device session tokens are persisted across native app restarts so privileged flows remain stable after relaunch.

## CI/CD rules
- The production CI/CD workflow only triggers a mobile release after the main quality gates and production deploy jobs succeed.
- If the main CI/CD pipeline fails, the mobile release job does not publish a new version.
- Mobile binary releases are scoped to native/mobile-runtime changes so the overall pipeline stays faster.
- GitHub Release publication is the free distribution lane. Google Play and TestFlight publication are fully automated when their credentials are configured, and safely skipped when they are not.
- Each mobile release includes release notes with what/why/how context plus a machine-readable `Aura-Mobile-Release-Manifest-<version>.json`.
- Installed mobile shells check the mobile release lane and show an in-app update prompt when a newer native APK/IPA package is available.

## Android artifacts
- CI can publish:
  - `Aura-Marketplace-Android-<version>.apk`
  - `Aura-Marketplace-Android-<version>.aab`
- Required GitHub secrets:
  - `FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_BASE64`
  - `ANDROID_RELEASE_KEYSTORE_BASE64`
  - `ANDROID_RELEASE_KEYSTORE_PASSWORD`
  - `ANDROID_RELEASE_KEY_ALIAS`
  - `ANDROID_RELEASE_KEY_PASSWORD`
- Optional Google Play publication secrets:
  - `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`
  - optional GitHub variable `ANDROID_PLAY_TRACK` defaults to `internal`
- If the keystore secrets are missing, CI still produces a release build signed with the debug keystore for internal testing only.

## iOS artifacts
- CI always targets a simulator build.
- CI can additionally export a signed IPA when Apple signing assets are configured.
- Required GitHub secrets for a signed IPA:
  - `FIREBASE_IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64`
  - `IOS_SIGNING_CERTIFICATE_P12_BASE64`
  - `IOS_SIGNING_CERTIFICATE_PASSWORD`
  - `IOS_PROVISIONING_PROFILE_BASE64`
  - `IOS_TEAM_ID`
  - `IOS_PROVISIONING_PROFILE_SPECIFIER`
- Optional TestFlight publication secrets:
  - `APP_STORE_CONNECT_KEY_ID`
  - `APP_STORE_CONNECT_ISSUER_ID`
  - `APP_STORE_CONNECT_API_KEY_P8_BASE64`
  - optional GitHub variable `IOS_EXPORT_METHOD` defaults to `app-store-connect` when TestFlight credentials are present, otherwise `ad-hoc`

## Important iPhone note
- A real iPhone install for other users still requires Apple signing and provisioning.
- The repo is prepared for that path, but Apple distribution itself is not free and cannot be completed from Windows alone.
- iOS cannot silently self-install updates from a GitHub Release. Real automatic updates for normal iPhone users come from TestFlight/App Store distribution; the free release lane can only open the latest IPA/release page.

## Local commands
- From repo root:
  - `npm run mobile:doctor`
  - `npm run mobile:sync`
  - `npm run mobile:sync:android`
  - `npm run mobile:sync:ios`
- From `app/`:
  - `npm run mobile:open:android`
  - `npm run mobile:open:ios`
