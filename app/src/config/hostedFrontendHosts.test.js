import { describe, expect, it } from 'vitest';
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
        'aura-storefront-production.up.railway.app',
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

    test('planned custom host stays a documented slot', () => {
        expect(PLANNED_CUSTOM_FRONTEND_HOSTS).toContain('aurapilot.aws.app');
    });
});
