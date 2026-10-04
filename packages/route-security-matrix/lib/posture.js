// Postures: the declared unauthenticated behavior of a route. Every
// state-changing route must carry an explicit posture — absence of a decision
// is itself a failure (see `resolvePosture` returning 'undeclared').
//
//   auth    — requires an authenticated session/bearer; unauthenticated probe
//             must return 401 or 403.
//   admin   — auth plus an admin gate; unauthenticated probe must return 401
//             or 403.
//   public  — intentionally open; probe must not return a 5xx.
//   preauth — part of the pre-authentication journey (OTP send/verify,
//             recovery-code verify, device bootstrap); validation and abuse
//             controls run before any session exists, so a 4xx rejection is
//             the expected unauthenticated outcome.
//   env-gated-public — runs unauthenticated only behind a runtime feature
//             flag. Probe must not return a 5xx.
//   signed-assertion — trust comes from a cryptographic request assertion
//             (e.g. a device-owner token), not a session; garbage input must
//             be rejected with a 4xx.
//   webhook — signature/secret verified; unauthenticated probe must return a
//             4xx rejection, or 503 when the receiver is deliberately
//             unconfigured (fail-closed).
//   skip    — excluded from probing; requires a justification in the config.

const POSTURES = ['auth', 'admin', 'public', 'preauth', 'env-gated-public', 'signed-assertion', 'webhook', 'skip'];

const METHOD_PATH_SEPARATOR = ' ';

const overrideKey = (route) => `${route.method}${METHOD_PATH_SEPARATOR}${route.path}`;

/**
 * Resolve a route's posture: per-route override (`"METHOD <mounted-path>"`)
 * first, then the file-level default, then 'undeclared'.
 */
const resolvePosture = (route, { routePostures, routePostureOverrides }) =>
    routePostureOverrides?.[overrideKey(route)]
    || routePostures?.[route.file]
    || 'undeclared';

/**
 * Replace Express `:param` segments with a plausible id so probing reaches
 * the route's own guards instead of a path-level 404.
 */
const resolveProbePath = (routePath, pathParamId = '507f1f77bcf86cd799439011') =>
    routePath.replace(/:[^/]+/g, pathParamId);

/**
 * Whether an observed unauthenticated status satisfies a route's posture.
 *
 * A 503 is treated as a deliberate fail-closed answer in every guarded
 * posture: a guard's downstream dependency (Redis, signature verifier,
 * internal-auth secret) is absent from the runtime environment, and
 * refusing everything is a stricter rejection than 401 — never a
 * pass-through.
 *
 * @param {number} status observed unauthenticated response status
 * @param {string} posture declared posture
 * @returns {boolean}
 */
const statusSatisfiesPosture = (status, posture) => {
    const failClosed = status === 503;
    if (posture === 'public' || posture === 'env-gated-public') {
        return failClosed || status < 500;
    }
    if (
        posture === 'webhook'
        || posture === 'preauth'
        || posture === 'signed-assertion'
    ) {
        return failClosed || (status >= 400 && status < 500);
    }
    if (posture === 'auth' || posture === 'admin') {
        return status === 401 || status === 403 || failClosed;
    }
    // 'skip' and 'undeclared' are configuration concerns, not probe concerns.
    return true;
};

module.exports = {
    POSTURES,
    overrideKey,
    resolvePosture,
    resolveProbePath,
    statusSatisfiesPosture,
};
