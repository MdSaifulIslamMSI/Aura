// Shared e2e helper for the third-party telemetry consent gate.
//
// The consent decision lives in localStorage, and the default is "undecided",
// which the app treats as "denied" - nothing is captured. A first visit
// therefore renders the consent prompt, which is a fixed bottom overlay and
// can sit on top of a page's primary control. Specs that exercise bottom-
// anchored UI seed the decision so they test the product surface they are
// about rather than the first-visit prompt.

export const TELEMETRY_CONSENT_STORAGE_KEY = 'aura.telemetry.consent';
export const TELEMETRY_CONSENT_GRANTED = 'granted';
export const TELEMETRY_CONSENT_DENIED = 'denied';

/**
 * Seeds a telemetry consent decision before any page script runs.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'granted'|'denied'} [decision]
 */
export const seedTelemetryConsent = async (page, decision = TELEMETRY_CONSENT_DENIED) => {
    await page.addInitScript(
        ({ key, value }) => {
            try {
                window.localStorage.setItem(key, value);
            } catch {
                // Storage unavailable (private mode); the app still treats the
                // missing decision as denied.
            }
        },
        { key: TELEMETRY_CONSENT_STORAGE_KEY, value: decision },
    );
};
