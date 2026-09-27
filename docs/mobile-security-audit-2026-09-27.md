# Mobile Application Security & Robustness Audit — 2026-09-27

Scope: the Capacitor native shell (`app/android`, `app/ios`, `app/capacitor.config.ts`), the
JS mobile bridge surface (`nativeAppExperience`, `nativeSocialAuth`, `deviceTrustClient`,
`mobileReleaseChannel`, `MobileUpdateBanner`, `MobileNativeTabBar`, runtime contexts), and the
mobile release lane (`.github/workflows/mobile-release.yml`, fastlane). Findings are mapped to
OWASP MASVS v2 domains. Status is the state after the same-day hardening batch.

## Verdict snapshot

| Domain | Before | After |
|---|---|---|
| Storage & privacy (MASVS-STORAGE) | Weak | Strong |
| Network (MASVS-NETWORK) | Partial | Strong |
| Platform interaction (MASVS-PLATFORM) | Weak | Strong |
| Resilience & anti-tamper (MASVS-RESILIENCE) | Weak | Good |
| Auth & session (MASVS-AUTH) | Strong | Strong |

## Findings and dispositions

### Critical — fixed same day

1. **Release keystore material stored inside the repo working tree with a plaintext password**
   (`keystore-backup/README.txt`), guarded only by machine-local `.git/info/exclude`; the `.b64`
   wrapper and README matched no `.gitignore` pattern and no scanner rule. A clone elsewhere and
   one `git add -A` leaked the app's signing identity.
   *Fix:* keystore + credentials relocated to `%USERPROFILE%\.aura-keystore` (outside every
   checkout); `keystore-backup/` and `*.keystore.b64` added to `.gitignore`; the tracked-file
   secret scanner (`scripts/security-secret-scan.mjs`) now flags `*.keystore.b64` and any
   `keystore-backup/` path. (MASVS-STORAGE / supply chain)

2. **Wildcard WebView navigation trust: `*.up.railway.app`** in `capacitor.config.ts`
   `allowNavigation`. Capacitor injects the native bridge into allowed origins, so any
   attacker-rentable Railway subdomain could render inside the app WebView as a trusted,
   bridge-capable page (in-app phishing with native access).
   *Fix:* replaced with the concrete fleet host `aura-storefront-production.up.railway.app`.
   (MASVS-PLATFORM)

3. **Zero integrity verification of release artifacts.** CI never verified the produced APK
   signature (a silent debug-signing fallback existed in `build.gradle:77`), and the in-app
   update banner offered the raw GitHub asset URL with no host allowlist and no checksum.
   *Fix:* gradle fails `assembleRelease` without keystore env (debug lane uses `assembleDebug`
   explicitly); CI runs `apksigner verify --print-certs` and fails unless the cert SHA-256
   matches `vars.AURA_ANDROID_CERT_SHA256`; release manifest (schema v2) embeds per-asset
   SHA-256 + size; `mobileReleaseChannel.js` accepts download URLs only from
   `github.com/MdSaifulIslamMSI/Aura/releases/download/<tag>/`, falls back to the release page,
   and resolves the manifest digest for display in the banner. (MASVS-RESILIENCE / supply chain)

4. **Backup and device-transfer exfiltration of auth state.** `android:allowBackup="true"` with
   no rules, while Firebase tokens live in WebView localStorage and the trusted-device session
   token in sessionStorage.
   *Fix:* `allowBackup="false"`, `dataExtractionRules` with empty cloud-backup and
   device-transfer sections, `fullBackupContent` empty include list. (MASVS-STORAGE)

### High — fixed same day

5. **No network security config.** Added `network_security_config.xml` with
   `cleartextTrafficPermitted=false` platform-wide; system CAs only. Certificate pinning is
   deliberately omitted: the storefront runs on managed platforms that rotate certificates, and
   a stale pin bricks installed shells. Revisit if/when the custom domain lands behind a pin-
   friendly CDN. (MASVS-NETWORK)

6. **FileProvider exposed filesystem roots** (`file_paths.xml` `path="."` on external and cache
   roots). Scoped to dedicated app-private `shared/` subdirectories. (MASVS-PLATFORM)

7. **Gradle wrapper downloaded without integrity check.** `distributionSha256Sum` pinned to the
   official Gradle 8.14.3 checksum. (Supply chain)

8. **Android hardware back button dead.** No `backButton` listener existed; Capacitor's default
   exits the app from any depth (product pages, checkout). `registerAndroidBackButtonHandler`
   navigates history back on inner flows and exits only from the five tab roots.
   (Robustness / platform conventions)

9. **Notification runtime permission never requested.** Android 13+ requires a native
   `POST_NOTIFICATIONS` runtime prompt; only the WebView `Notification` shim was used. Added
   `@capacitor/push-notifications`: `requestPermissions()` on installed runtimes (real Android
   13+ prompt), `register()` best-effort while FCM is absent. Foreground display stays on the
   Web Notification lane. (MASVS-PLATFORM / UX)

### Medium — fixed same day

10. **Update banner nags with unknown installed version.** `shouldShowRelease` returned true
    whenever `App.getInfo` failed. Now requires a strictly older known install. Unguarded
    `localStorage` access wrapped; hardcoded English strings moved to
    `mobileUpdate.*` i18n keys (fallback-filled across all 20 locale packs; translations flow
    through the documented repair pipeline).

11. **iOS App Tracking Transparency plugin calls unguarded** — raw rejections could crash the
    Facebook sign-in flow; now degrade to the structured permission-required error.

12. **Tablet/landscape navigation dead zone.** `MobileNativeTabBar` used `md:hidden` while the
    desktop navbar is suppressed in the shell — no nav chrome at all ≥768px on native. Tab bar
    is now visible at every width on native.

13. **Weak RNG fallbacks for device identity** (`Math.random`-based) replaced with a
    `crypto.getRandomValues` hex path; the legacy `Math.random` loop remains only as the final
    no-WebCrypto fallback. Desktop fallback also produces RFC-4122-shaped UUIDs now.

14. **Config/code disagreement on `skipNativeAuth`** (config `false`, all call-sites `true`).
    Config aligned to `true` so the plugin contract matches actual token handling.

15. **Placeholder Firebase API key in the gradle fallback kept deliberately.** The fallback
    resValues exist only to keep the native Firebase classes from crashing at init when
    `google-services.json` is absent; native Firebase calls cannot work in that state anyway
    (no Android app registration). Putting the real public web key in tracked source tripped
    the gitleaks `gcp-api-key` rule for no functional gain, so the placeholder stays. When
    native social auth is enabled, the real `google-services.json` (CI secret) supersedes the
    fallback entirely.

## Residual risks (accepted, monitored)

- **Firebase tokens in WebView localStorage** — deliberate (documented in `firebase.js:249`);
  mitigated by the WebView sandbox, session-scoped trusted-device tokens, non-extractable DPoP
  keys (IndexedDB), and the new backup lockdown. XSS remains the blast-radius carrier; the web
  CSP and the bridge-less origin model are the compensating controls.
- **No certificate pinning** — deliberate (see finding 5).
- **Background push (FCM/APNs)** — still credential-gated; the plugin groundwork is wired and
  degrades gracefully until `google-services.json` and backend device-token registry land.
- **iOS distribution** — simulator-only until Apple signing assets exist; not completable from
  Windows.
- **Store publishing lanes (fastlane)** — wired but unexercised until Play/ASC credentials
  exist; `bundle exec fastlane lanes` parse validation added in the follow-up CI batch.

## Verified

- `apksigner` gate + digest manifest: first exercised on the next signed release dispatch after
  this change set (v1.0.91).
- All mobile-surface unit suites green (channel, banner, tab bar, native experience, device
  trust, social auth, runtime detection).
