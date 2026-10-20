import { describe, expect } from 'vitest';
import {
    HOSTED_DEPLOYMENT_HOST_SUFFIXES,
    PLANNED_CUSTOM_FRONTEND_HOSTS,
} from '../../config/hostedFrontendHosts.mjs';

// Contract test for the shared hosted-host list: the Firebase social-auth
// gate previously dropped entire lanes (.pages.dev, .github.io,
// .up.railway.app) because each consumer kept its own copy. This pins the
// suffix families for every live storefront host so a lane can never
// silently fall out again.
describe('hostedFrontendHosts shared contract', () => {
    const liveStorefrontHosts = [
        'aurapilot.vercel.app',
        'aurapilot.netlify.app',
        'dbtrhsolhec1s.cloudfront.net',
        'aura-storefront.onrender.com',
        'aura-storefront.pages.dev',
        'mdsaifulislammsi.github.io',
    ];

    test('every live storefront host matches a hosted-deployment suffix', () => {
        for (const host of liveStorefrontHosts) {
            const matched = HOSTED_DEPLOYMENT_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
            expect(matched, `no suffix in HOSTED_DEPLOYMENT_HOST_SUFFIXES matches ${host}`).toBe(true);
        }
    });

    test('static-only lanes are explicitly covered', () => {
        expect(HOSTED_DEPLOYMENT_HOST_SUFFIXES).toContain('.pages.dev');
        expect(HOSTED_DEPLOYMENT_HOST_SUFFIXES).toContain('.github.io');
    });

    test('the retired Railway lane is no longer trusted', () => {
        // The Railway storefront lane was retired when the Railway trial
        // expired. `*.up.railway.app` is a shared-hosting namespace any
        // Railway account can claim, so trusting the suffix trusted every
        // tenant on it as a first-party Aura storefront.
        for (const suffix of ['.railway.app', '.up.railway.app']) {
            expect(HOSTED_DEPLOYMENT_HOST_SUFFIXES).not.toContain(suffix);
        }
        const matched = HOSTED_DEPLOYMENT_HOST_SUFFIXES.some((suffix) =>
            'attacker-chosen.up.railway.app'.endsWith(suffix),
        );
        expect(matched).toBe(false);
    });

    test('planned custom host stays a documented slot', () => {
        expect(PLANNED_CUSTOM_FRONTEND_HOSTS).toContain('aurapilot.aws.app');
    });
});
