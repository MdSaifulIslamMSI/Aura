// Single source of truth for which hosts count as Aura's hosted frontend
// fleet. Client detection sites (the Firebase social-auth gate in
// app/src/config/firebase.js, the runtime API host detection in
// app/src/services/runtimeApiConfig.js) derive from here, so adding a lane
// or the future custom domain only edits one file.
//
// PLANNED_CUSTOM_FRONTEND_HOSTS is the reserved slot for the upcoming
// custom domain; entries are inert until the domain actually serves the
// app, and removing them is the only change needed on domain day.

export const PLANNED_CUSTOM_FRONTEND_HOSTS = ['aurapilot.aws.app'];

// Suffixes every hosted storefront lane ends with, including static-only
// lanes (Cloudflare Pages, GitHub Pages) that have no same-origin /api
// proxy. Same-origin /api proxy semantics live in
// app/src/services/runtimeApiConfig.js (HOSTED_FRONTEND_HOST_SUFFIXES),
// which is deliberately narrower than this list.
export const HOSTED_DEPLOYMENT_HOST_SUFFIXES = [
    '.vercel.app',
    '.netlify.app',
    '.cloudfront.net',
    '.onrender.com',
    '.railway.app',
    '.up.railway.app',
    '.pages.dev',
    '.github.io',
];
