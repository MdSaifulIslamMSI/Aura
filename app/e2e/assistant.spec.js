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
        await expect(page.getByText('Aura Terminal')).toBeVisible();
        await expect(page.getByRole('button', { name: 'New chat', exact: true })).toBeVisible();
        await expect(page.getByPlaceholder('Search conversations')).toBeVisible();
        await expect(page.getByText('Controlled Terminal')).toBeVisible();
        await expect(page.getByText('Fast answers stay responsive, refined answers upgrade in place, and conversation state stays stable.')).toBeVisible();
        await expect(page.getByPlaceholder('Ask anything. I will keep the state controlled.')).toBeVisible();
        await expect(page.getByText('Today')).toBeVisible();
        await expect(page.getByText('Enter to send')).toBeVisible();
        await expect(page.getByText('Shift+Enter for newline')).toBeVisible();
        await expect(page.getByText('Attachments soon')).toBeVisible();
    });

    test('streams a fast response while preserving multiline composer behavior', async ({ page }) => {
        await page.route('**/api/ai/chat/stream', async (route) => {
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
                    token: responseText,
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
        await expect(page.getByText('Fast', { exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Quick answer' })).toBeVisible();
        await expect(page.locator('pre code')).toContainText("console.log('ok');");
        await expect(page.getByText('Stubbed browser smoke verification.')).toBeVisible();
    });
});
