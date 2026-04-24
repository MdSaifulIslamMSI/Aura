# Mobile App Delivery

Aura Marketplace now ships as Capacitor-based Android and iOS shells on top of the hosted production storefront.

## Delivery shape
- Android and iOS apps load the production Aura frontend from `https://aurapilot.vercel.app`.
- The native shells exist for installability, native auth support, app-icon presence, and store-ready packaging.
- Most product/UI changes arrive through the normal frontend deploy, so the mobile binaries do not need to be rebuilt for every web-only change.
- The public download surface is `https://aura-gateway.vercel.app/`, backed by the dedicated Vercel project `aura-gateway`.

## Native auth lane
- Web and desktop continue to use the existing Firebase web auth flow.
- Android and iPhone use the stable email/password plus backend OTP lane by default.
- Native Google, Facebook, X, and Firebase phone-SMS OTP are opt-in for installed mobile builds through `VITE_MOBILE_NATIVE_SOCIAL_AUTH_ENABLED=true` and `VITE_MOBILE_FIREBASE_PHONE_OTP_ENABLED=true`.
- Android includes Google and Facebook native provider dependencies whenever those providers are enabled, so the app does not crash while registering the native auth bridge.
- Free GitHub-release Android builds include a public Firebase resource fallback from the existing web Firebase config. A real `google-services.json` still takes priority when the GitHub secret is configured.
- The free fallback keeps the APK launch-safe, but it intentionally does not turn on native mobile social sign-in. Configure the real Firebase Android/iOS app files, OAuth client IDs, and provider credentials before enabling the native mobile social lane.
- Trusted-device session tokens are persisted across native app restarts so privileged flows remain stable after relaunch.

## Realtime, Calls, And Notifications
- Android and iOS shells declare camera, microphone, audio-routing, vibration, and Android 13+ notification permissions so chat, support calls, marketplace calls, and foreground alerts have the native access they need.
- The app warms microphone/camera permission from the user action that starts or answers a live call, then LiveKit publishes the actual call tracks. If the camera is unavailable, Aura keeps the audio lane alive where possible instead of crashing the call.
- Socket realtime reconnects after native app resume, visibility changes, and network recovery so chats, incoming calls, and notifications recover after the phone is locked or the app is backgrounded.
- Free GitHub APK/IPA distribution can surface in-app/foreground notifications. True background push to sleeping phones still requires FCM/APNs credentials and backend device-token endpoints; the CI/CD lane is ready to carry those secrets when configured.

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
- If `FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_BASE64` is missing, CI still builds a launch-safe APK using the public Firebase fallback values. Configure the secret plus `AURA_ANDROID_DEFAULT_WEB_CLIENT_ID`, then set `VITE_MOBILE_NATIVE_SOCIAL_AUTH_ENABLED=true` only after the Firebase Android app package/SHA fingerprints and OAuth providers are ready.

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
