# Login Provider Roadmap

## Current Provider State
The provider policy is codified in `server/config/authProviderPolicy.js`.

| Provider | State | Notes |
|---|---|---|
| Email/password | Active | Firebase-backed; backend session is authoritative. |
| Phone OTP | Active | Firebase phone OTP plus backend OTP fallback paths. |
| Google | Active | Firebase social provider. |
| Facebook | Active | Firebase social provider. |
| X | Active | Firebase social provider. |
| Microsoft | Active | Microsoft Entra app registration, Firebase `microsoft.com` provider, and CloudFront frontend exposure are enabled. Browser smoke confirms the Microsoft button is visible while Apple remains hidden. Existing-email collisions can be resolved by signing in with the current method, then linking Microsoft from Profile > Settings. |
| Apple | Ready when enabled | Frontend support exists behind `VITE_FIREBASE_ENABLE_APPLE_AUTH=true`; Apple developer/Firebase provider credentials are still required. |
| Enterprise OIDC | Design required | Do only when an enterprise customer needs it. |
| Enterprise SAML | Design required | Do only when an enterprise customer needs it. |

## Activation Rules
1. Do not enable Apple in production until Apple Developer credentials, authorized domains, mobile redirect settings, and staging browser smoke are complete.
2. Keep `VITE_FIREBASE_ENABLE_MICROSOFT_AUTH=true` in production builds while the Firebase `microsoft.com` provider remains enabled; repeat browser smoke after provider or domain changes.
3. Keep enterprise OIDC/SAML out of the consumer login UI until tenant routing, IdP metadata lifecycle, logout semantics, and account-linking behavior are designed.
4. Backend session sync remains the source of truth for user role and assurance state regardless of provider.
