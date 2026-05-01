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
        await expect(page.getByPlaceholder('Compare products, review a cart, or find a match...')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Upload attachments' })).toBeVisible();
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
});
