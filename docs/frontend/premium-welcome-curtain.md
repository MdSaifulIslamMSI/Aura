# Premium Welcome Curtain

Aura shows a first-visit welcome curtain at the app root when the feature is enabled. It is a fixed overlay with CSS-only curtain motion, changing premium color gradients, a short copy sequence, and a skip control. The app routes keep rendering behind it, so auth initialization, protected route checks, admin routes, checkout, desktop, mobile, and SEO metadata are not changed by this feature.

## Flags

- `VITE_WELCOME_CURTAIN_ENABLED=false` disables the curtain.
- `VITE_WELCOME_CURTAIN_ENABLED=true` enables it in any environment.
- When the flag is unset, the curtain is enabled only for production builds.
- `VITE_WELCOME_CURTAIN_SOUND_ENABLED=false` disables the sound control and chime.

## Session Behavior

The curtain displays once per browser session. Closing it writes `aura.welcomeCurtain.seen=true` to `sessionStorage`. If storage is unavailable, the curtain still closes and the app remains usable.

## Accessibility

- The overlay uses `role="dialog"` and `aria-label="Welcome to Aura"`.
- The skip button receives focus while the curtain is visible.
- Escape closes the curtain.
- Focus is restored to the previous element when practical.
- The component does not use an aggressive focus trap because it auto-closes quickly.
- `prefers-reduced-motion: reduce` switches to a simple fade path and disables the welcome chime.

## Sound

The welcome sound is synthesized with the Web Audio API. No audio files or copyrighted assets are used. The chime is low volume, under one second, and only requested after a user gesture such as clicking or touching the curtain. Browser audio failures are caught and ignored.

The sound preference is stored in `localStorage` as `aura.welcomeCurtain.soundMuted`.

## Verification

Focused tests:

```sh
npm --prefix app test -- src/components/welcome/PremiumWelcomeCurtain.test.jsx
```

Frontend checks:

```sh
npm --prefix app run lint
npm --prefix app run build
```

Root checks:

```sh
npm test
npm run lint
npm run build
```
