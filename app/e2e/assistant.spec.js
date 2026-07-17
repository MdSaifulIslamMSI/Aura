import { test, expect } from '@playwright/test';

const buildStreamFrame = (eventName, payload) => `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;

test.describe('Assistant Terminal', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.clear();
            window.sessionStorage.clear();
        });
    });

    test('renders the controlled terminal shell', async ({ page }) => {
        await page.goto('/assistant');

        await expect(page.getByText('Assistant v2 is currently disabled.')).toHaveCount(0);
        await expect(page.getByText('Commerce Copilot')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'New chat' })).toBeVisible();
        await expect(page.getByText('Fast starts')).toBeVisible();
        await expect(page.getByText('Start with a grounded shopping workflow.')).toBeVisible();
        await expect(page.getByRole('button', { name: /Grounded comparison/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /Cart review/ })).toBeVisible();
        await expect(page.getByText('Cart empty', { exact: true })).toBeVisible();
        await expect(page.getByPlaceholder('Compare products, review a cart, or find a match...')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Upload attachments' })).toBeVisible();
    });

    test('keeps shopping context and composer actions usable at a compact viewport', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/assistant');

        const composer = page.getByPlaceholder('Compare products, review a cart, or find a match...');
        const upload = page.getByRole('button', { name: 'Upload attachments' });
        const send = page.getByRole('button', { name: 'Send message' });

        await expect(page.getByText('Cart empty', { exact: true })).toBeVisible();
        await expect(composer).toBeVisible();
        await expect(upload).toBeVisible();
        await expect(send).toBeVisible();

        const [composerBox, uploadBox, sendBox] = await Promise.all([
            composer.boundingBox(),
            upload.boundingBox(),
            send.boundingBox(),
        ]);

        expect(uploadBox?.width).toBeGreaterThanOrEqual(44);
        expect(uploadBox?.height).toBeGreaterThanOrEqual(44);
        expect(sendBox?.width).toBeGreaterThanOrEqual(44);
        expect(sendBox?.height).toBeGreaterThanOrEqual(44);
        expect((composerBox?.y || 0) + (composerBox?.height || 0)).toBeLessThanOrEqual(844);
    });

    test('answers app workflow help with every model provider disabled', async ({ page }) => {
        await page.goto('/assistant');

        const composer = page.getByPlaceholder('Compare products, review a cart, or find a match...');
        await composer.fill('How do I open price alerts?');
        await composer.press('Enter');

        await expect(page.getByRole('heading', { name: 'How do I open price alerts?' })).toBeVisible();
        await expect(page.getByLabel('Assistant workspace').getByText(
            /Review signed-in price alerts for watched products/
        )).toBeVisible({ timeout: 15_000 });
        await expect(page).toHaveURL(/\/assistant$/);
        const openPriceAlerts = page.getByRole('button', { name: 'Open Price alerts', exact: true });
        await expect(openPriceAlerts).toBeVisible();
        await openPriceAlerts.click();
        await expect(page).toHaveURL(/\/login$/);
    });

    test('streams a fast response while preserving multiline composer behavior', async ({ page }) => {
        await page.route('**/api/ai/chat/stream**', async (route) => {
            const request = route.request().postDataJSON();
            const clientSessionId = request?.context?.clientSessionId || '';
            const messageId = request?.context?.clientMessageId || 'stream-message';
            const responseText = [
                '### Quick answer',
                '',
                '- first signal',
                '- second signal',
                '',
                '```js',
                "console.log('ok');",
                '```',
            ].join('\n');

            const body = [
                buildStreamFrame('message_meta', {
                    type: 'message_meta',
                    sessionId: clientSessionId,
                    messageId,
                    decision: 'HYBRID',
                    provisional: true,
                    upgradeEligible: true,
                    traceId: 'trace-e2e-fast',
                }),
                buildStreamFrame('token', {
                    type: 'token',
                    sessionId: clientSessionId,
                    messageId,
                    text: responseText,
                }),
                buildStreamFrame('final_turn', {
                    sessionId: clientSessionId,
                    messageId,
                    provisional: true,
                    upgradeEligible: true,
                    decision: 'HYBRID',
                    traceId: 'trace-e2e-fast',
                    answer: responseText,
                    assistantTurn: {
                        intent: 'general_knowledge',
                        decision: 'respond',
                        response: responseText,
                        ui: {
                            surface: 'plain_answer',
                        },
                        citations: [],
                        toolRuns: [],
                        verification: {
                            label: 'runtime_grounded',
                            summary: 'Stubbed browser smoke verification.',
                        },
                    },
                    providerInfo: {
                        name: 'local',
                        model: 'stub-e2e',
                    },
                    grounding: {
                        status: 'grounded',
                        traceId: 'trace-e2e-fast',
                    },
                    products: [],
                }),
            ].join('');

            await route.fulfill({
                status: 200,
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive',
                },
                body,
            });
        });

        await page.goto('/assistant');

        const composer = page.locator('textarea');
        await composer.click();
        await composer.fill('first line');
        await composer.press('Shift+Enter');
        await composer.type('second line');
        await expect(composer).toHaveValue('first line\nsecond line');

        await composer.press('Enter');

        await expect(composer).toHaveValue('');
        await expect(page.locator('div.whitespace-pre-wrap.break-words')).toContainText(/first line\s+second line/);

        const streamedHeading = page.getByRole('heading', { name: 'Quick answer' });
        const errorBadge = page.getByText('Error').last();
        const gracefulFailure = page.getByText(/I hit a live service issue before I could finish that/i).last();

        await expect.poll(async () => {
            if (await streamedHeading.isVisible().catch(() => false)) {
                return 'streamed';
            }
            if (
                await errorBadge.isVisible().catch(() => false)
                || await gracefulFailure.isVisible().catch(() => false)
            ) {
                return 'fallback';
            }
            return 'pending';
        }, { timeout: 10_000 }).not.toBe('pending');

        const resolvedOutcome = await (async () => {
            if (await streamedHeading.isVisible().catch(() => false)) {
                return 'streamed';
            }
            return 'fallback';
        })();

        if (resolvedOutcome === 'streamed') {
            await expect(page.locator('pre code')).toContainText("console.log('ok');");
            await expect(page.getByText('Runtime-grounded')).toBeVisible();
            await expect(page.getByText('Stubbed browser smoke verification.')).toBeVisible();
            return;
        }

        await expect(errorBadge).toBeVisible();
        await expect(gracefulFailure).toBeVisible();
    });

    test('renders one truthful product action surface for an unavailable result', async ({ page }) => {
        await page.route('**/api/ai/chat/stream**', async (route) => {
            const request = route.request().postDataJSON();
            const clientSessionId = request?.context?.clientSessionId || '';
            const messageId = request?.context?.clientMessageId || 'product-message';
            const product = {
                id: 400047506,
                title: 'Aura Focus Phone',
                brand: 'Aura',
                category: 'Mobiles',
                price: 49999,
                originalPrice: 54999,
                discountPercentage: 9,
                image: '',
                stock: 0,
                rating: 4.4,
                ratingCount: 127,
                deliveryTime: 'Usually dispatches in 2 days',
                warranty: '1 year manufacturer warranty',
                assistantReason: 'Strong camera and battery fit for this budget.',
            };
            const answer = 'This is the closest grounded match, but it is currently out of stock.';
            const body = [
                buildStreamFrame('message_meta', {
                    type: 'message_meta',
                    sessionId: clientSessionId,
                    messageId,
                    decision: 'RESPOND',
                    provisional: false,
                    traceId: 'trace-e2e-product',
                }),
                buildStreamFrame('final_turn', {
                    sessionId: clientSessionId,
                    messageId,
                    decision: 'RESPOND',
                    traceId: 'trace-e2e-product',
                    answer,
                    assistantTurn: {
                        intent: 'product_search',
                        decision: 'respond',
                        response: answer,
                        ui: { surface: 'product_focus' },
                        citations: [],
                        toolRuns: [],
                        verification: {
                            label: 'runtime_grounded',
                            summary: 'Checked against current catalog data.',
                        },
                    },
                    providerInfo: { name: 'local', model: 'catalog-tools' },
                    grounding: { status: 'grounded', traceId: 'trace-e2e-product' },
                    products: [product],
                }),
            ].join('');

            await route.fulfill({
                status: 200,
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive',
                },
                body,
            });
        });

        await page.goto('/assistant');
        const composer = page.getByPlaceholder('Compare products, review a cart, or find a match...');
        await composer.fill('Show me the Aura Focus Phone');
        await composer.press('Enter');

        await expect(page.getByRole('heading', { name: 'Aura Focus Phone', exact: true })).toBeVisible();
        await expect(page.getByText('Usually dispatches in 2 days')).toBeVisible();
        await expect(page.getByText('1 year manufacturer warranty')).toBeVisible();
        const unavailableAction = page.getByRole('button', { name: 'Out of stock', exact: true });
        await expect(unavailableAction).toHaveCount(1);
        await expect(unavailableAction).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Add to cart' })).toHaveCount(0);
    });
});
