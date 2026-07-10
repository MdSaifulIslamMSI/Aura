# Aura Gateway next-level redesign

## Intent

- Surface: a static production gateway, not a marketing microsite or deployment dashboard.
- Audience: shoppers choosing a production storefront and users choosing the safest install path for their device.
- Main job: make the correct runtime or install lane obvious without weakening release verification or platform warnings.
- Art direction: **Tactile Minimal** with a **Precision Operations** accent—deep ink, warm metal, restrained teal/steel signals, editorial display type, and compact operational labels.
- Layout: a cinematic but action-led hero, an explicit multi-edge command layer, concise trust evidence, and a searchable platform matrix that progressively enhances the complete static content.
- Motion: only short opacity/transform feedback; all nonessential motion stops under `prefers-reduced-motion`.
- Performance: retain static HTML/CSS, avoid a framework or animation dependency, remove remote font blocking, and serve an optimized hero source with the existing PNG as fallback.

## Preserved contract

- Keep the Vercel, Netlify, CloudFront, AWS Control, GitHub Releases, and hosted Aura destinations unchanged.
- Keep every existing release resolver and its GitHub Releases fallback; never synthesize or guess an asset URL.
- Keep SHA-256 hydration, fail-closed checking/unknown/unavailable states, and the checksum manifest behavior.
- Keep unsigned Windows, Android debug-build, Apple signing/provisioning, admin-only, RTOS, embedded, and legacy-platform limitations visible.
- Keep the deployment surface static under `gateway/`; do not change backend APIs, environment variables, auth, data, or production workflow contracts.

## Implementation shape

1. Strengthen semantic structure with a skip link, one clear `h1`, explicit hero CTAs, labelled route/status regions, and a real footer.
2. Turn the four production routes into a scannable command layer with factual role and safety copy.
3. Add a tiny progressive-enhancement script for current-device guidance plus category/search filtering; with JavaScript disabled, all platform cards remain visible and usable.
4. Add stable platform identifiers/categories without changing the existing download or fallback anchors.
5. Extend the existing gateway contract validator so CI protects runtime links, admin-only labelling, accessibility landmarks, platform coverage, fallback links, and optimized asset bounds.

## Verification

- Tracer: `npm run gateway:release-contract` before and after the change.
- Static/live contract: `npm run gateway:release-contract -- --live` when GitHub is reachable.
- Repository checks: relevant lint/typecheck/build commands discovered from `package.json` and CI path filters.
- Browser QA: desktop, tablet, and mobile layouts; keyboard flow; reduced motion; live release hydration; forced release-API fallback; console errors; and link integrity.
- Release gate: preview deployment and required PR checks must be green before merge; production verification must use the public gateway URL after the deployment workflow completes.
