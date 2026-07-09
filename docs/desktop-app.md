# Aura Marketplace Desktop

This repo includes an Electron wrapper that turns the frontend into downloadable desktop apps for Windows, macOS, and Linux.

## What It Does

- Builds the React frontend from `app/`
- Starts a local desktop runtime on `127.0.0.1`
- Proxies `/api`, `/health`, `/uploads`, and `socket.io` traffic to the configured backend origin
- Packages Windows, macOS, and Linux artifacts with `electron-builder`
- Publishes release artifacts through GitHub Releases
- Checks the latest release channel for automatic desktop app updates

The packaged app uses the configured hosted backend origin:

- `AURA_DESKTOP_BACKEND_ORIGIN`
- `AURA_DESKTOP_AUTH_FRONTEND_ORIGIN`
- `AURA_DESKTOP_AUTH_ALLOWED_ORIGINS`

Override that target at launch or build time with:

- PowerShell: `$env:AURA_DESKTOP_BACKEND_ORIGIN='http://127.0.0.1:5000'`
- PowerShell: `$env:AURA_DESKTOP_AUTH_FRONTEND_ORIGIN='https://aurapilot.vercel.app'`

## Hosted Desktop Login Bridge

Desktop browser sign-in opens the hosted Vercel route `/desktop-login` instead of the full local app. The hosted page keeps the same Firebase, OTP, social, Turnstile, backend custom-token, audit, and rate-limit flow as the normal login screen, but it returns the completed session to the desktop runtime through a one-time loopback callback.

Security invariants for this bridge:

- The desktop runtime generates a short-lived `desktopAuthRequest` and secret for every browser handoff.
- The hosted page can only post the custom token to an explicit loopback callback such as `http://localhost:47831/desktop-auth/complete`.
- The local callback accepts CORS and Private Network Access preflights only from `AURA_DESKTOP_AUTH_FRONTEND_ORIGIN` plus any comma-separated entries in `AURA_DESKTOP_AUTH_ALLOWED_ORIGINS`.
- The page CSP allows the loopback callback but does not relax API/backend origins for arbitrary hosts.
- The desktop app receives only a Firebase custom token result, never Firebase Admin secrets or backend signing material.

## Owner Desktop Access

Owner desktop access is a fail-closed emergency sign-in path for the repository owner. It does not use code-signing certificates, and it is not a general user bypass.

The public desktop app only shows the owner access button when the local Electron process has owner access enabled and local key material available. Public downloads should ship with this unset.

Server-side requirements:

- `AURA_DESKTOP_OWNER_ACCESS_ENABLED=true`
- `AURA_DESKTOP_OWNER_FIREBASE_UID=<owner Firebase uid>`
- `AURA_DESKTOP_OWNER_ACCESS_KEY=<high-entropy owner key>` or `AURA_DESKTOP_OWNER_ACCESS_KEY_BASE64=<base64url key>`

Desktop-side requirements:

- `AURA_DESKTOP_OWNER_ACCESS_ENABLED=true`
- `AURA_DESKTOP_OWNER_ACCESS_KEY=<same high-entropy owner key>` or `AURA_DESKTOP_OWNER_ACCESS_KEY_FILE=<local uncommitted key file>`

Security invariants:

- The desktop app never sends an owner UID, email, role, or privilege claim.
- The backend maps a valid owner assertion only to `AURA_DESKTOP_OWNER_FIREBASE_UID`.
- Every request signs a fresh request id, timestamp, and nonce with HMAC-SHA256.
- Assertions expire quickly and are rejected on replay within the backend process.
- Missing, short, or mismatched keys fail closed.

## Commands

- `npm run desktop:start`
  - Builds the frontend and opens the Electron desktop shell locally.
- `npm run desktop:pack`
  - Creates an unpacked desktop app directory for quick inspection.
- `npm run desktop:dist`
  - Builds the default Windows x64 installer and portable app into `desktop-release/`.
- `npm run desktop:dist:win:all`
  - Builds Windows x64, ARM64, and 32-bit installer/portable artifacts.
- `npm run desktop:dist:mac`
  - Builds macOS DMG and ZIP artifacts for Apple Silicon and Intel Macs. Run this on macOS.
- `npm run desktop:dist:linux`
  - Builds Linux AppImage, Deb, RPM, and tar.gz artifacts for x64 and ARM64. Run this on Linux.
- `npm run desktop:dist:portable`
  - Builds a portable Windows x64 executable into `desktop-release/`.

## First-Time Setup

1. Install root dependencies:
   - `npm install`
2. Make sure app dependencies are installed:
   - `npm --prefix app install`
3. Configure the frontend auth env in `app/.env` or the release environment:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
4. Start or package the desktop app with one of the commands above.

## Output

Installer artifacts are written to:

- `desktop-release/`

Typical latest-download artifact names:

- `Aura-Marketplace-Windows-x64-Setup.exe`
- `Aura-Marketplace-Windows-arm64-Setup.exe`
- `Aura-Marketplace-Windows-ia32-Setup.exe`
- `Aura-Marketplace-Windows-x64-Portable.exe`
- `Aura-Marketplace-macOS-arm64.dmg`
- `Aura-Marketplace-macOS-x64.dmg`
- `Aura-Marketplace-Linux-x86_64.AppImage`
- `Aura-Marketplace-Linux-amd64.deb`
- `Aura-Marketplace-Linux-x86_64.rpm`
- `Aura-Marketplace-Linux-x64.tar.gz`

## Automated Releases And Updates

The workflow at `.github/workflows/desktop-release.yml` builds all desktop targets when called by `.github/workflows/production-cicd.yml` and on manual dispatch.

- Each run stamps a unique desktop version like `1.0.<run_number>`.
- The workflow creates a GitHub Release tag like `desktop-v1.0.42`.
- Release builds fail before packaging if the required `VITE_FIREBASE_*` web auth variables are missing or still set to placeholders.
- Release assets use stable names so the gateway can always link to the latest build.
- Installed apps use `electron-updater` and the GitHub Release metadata files (`latest.yml`, `latest-mac.yml`, and `latest-linux.yml`) to discover updates.
- Packaged apps check for updates on startup and every four hours while running.
- Updates download automatically; when ready, users can restart immediately or install on next quit.
- Free production release publishing allows unsigned Windows builds. CI and deploy gates still have to pass before the latest release channel moves, but unsigned Windows installers can show Microsoft Defender SmartScreen warnings.

## Realtime, Calls, And Notifications

- The Electron shell grants camera, microphone, desktop notification, fullscreen, and screen-share permissions only to the trusted Aura runtime origins.
- Desktop windows run with background throttling disabled so active calls and socket heartbeats are not aggressively paused when the app is behind another window.
- macOS builds include camera and microphone usage descriptions for system privacy prompts.
- Foreground chat/call/notification delivery uses the same socket and LiveKit lanes as the web app. Desktop system notifications are shown through the Electron runtime when the OS allows notifications.

Manual release with a specific version:

- Open the `Desktop Release` GitHub Actions workflow.
- Run workflow with a version such as `1.1.0`.

## Gateway Downloads

The gateway page at `gateway/index.html` includes a desktop downloads section. It links to:

- Windows installers and portable builds
- macOS Apple Silicon and Intel builds
- Linux AppImage, Deb, RPM, and tar.gz builds
- GitHub latest release notes

The gateway deploy workflow publishes the page to:

- `https://aura-gateway.vercel.app/`

The gateway buttons start with a safe fallback to the GitHub releases page, then use the GitHub latest-release API to resolve each button to its exact asset URL once the asset exists. This avoids sending users to raw 404 pages before the first full release has been published.

## Production Signing Notes

The free release path publishes unsigned Windows builds and does not require paid signing. For a production experience like major desktop apps, release artifacts need platform trust:

- Windows: add either an Authenticode PFX certificate through `WINDOWS_CODE_SIGNING_CERTIFICATE_BASE64` and `WINDOWS_CODE_SIGNING_CERTIFICATE_PASSWORD`, or Microsoft Trusted Signing secrets through the Azure signing variables documented in `docs/ci-cd.md`. CI signs and verifies Windows `.exe` files only when `require_windows_signing=true` or a complete signing path is intentionally configured for the run.
- macOS: add Apple Developer ID signing and notarization credentials.
- Linux: publish checksums and optionally sign release checksums with GPG.

The gateway exposes GitHub-provided SHA-256 release asset digests for ready desktop and mobile downloads. These checksums
let users verify file integrity after download, but they do not make unsigned Windows or macOS builds equivalent to
signed/notarized public releases.

The desktop release workflow also attaches `Aura-Desktop-SHA256SUMS-<version>.txt` to each GitHub Release and builds the
release notes from the actual artifact list. The release page should name the right package per operating system, show
the gated workflow/source commit, and keep signing status separate from checksum integrity.

To create the Windows certificate secret from a `.pfx` file, run this locally and paste the output into the GitHub secret:

- PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\aura-code-signing.pfx"))`

Without trusted Windows signing, users may see Microsoft Defender SmartScreen warnings even though the files are generated by CI. Free unsigned builds are usable, but Windows will not treat them like a trusted big-company app. A paid OV or EV Windows code-signing certificate is required to reduce or remove that warning for public users. EV certificates usually gain SmartScreen trust fastest; OV certificates may still need reputation to build over time.

Portable Windows builds are provided for users who cannot run an installer, but normal installed packages are the primary auto-update path.

## Notes

- The desktop build packages the frontend only. It does not bundle MongoDB or the Express backend runtime.
- Internet access is still required unless you point `AURA_DESKTOP_BACKEND_ORIGIN` at a reachable backend.
- This keeps backend secrets out of the desktop installer while still giving users a proper downloadable app experience.
