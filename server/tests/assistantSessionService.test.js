const {
    __resetAssistantSessionsForTests,
    createActionId,
    markActionExecuted,
    resolveAssistantSession,
    updateAssistantSession,
    validatePendingAction,
} = require('../services/ai/assistantSessionService');

describe('assistantSessionService', () => {
    beforeEach(() => {
        __resetAssistantSessionsForTests();
    });

    test('persists session state across updates and reloads', async () => {
        const session = await resolveAssistantSession({
            context: {
                currentProductId: 'iphone-15',
                currentProduct: {
                    id: 'iphone-15',
                    title: 'Apple iPhone 15',
                },
            },
        });

        const updated = await updateAssistantSession({
            sessionId: session.sessionId,
            baseSession: session,
            patch: {
                lastIntent: 'product_search',
                lastEntities: {
                    query: 'iphone',
                    productId: 'iphone-15',
                },
                incrementContextVersion: true,
            },
        });

        const reloaded = await resolveAssistantSession({
            sessionId: updated.sessionId,
        });

        expect(reloaded).toMatchObject({
            sessionId: updated.sessionId,
            lastIntent: 'product_search',
            lastEntities: expect.objectContaining({
                query: 'iphone',
                productId: 'iphone-15',
            }),
            activeProduct: expect.objectContaining({
                id: 'iphone-15',
            }),
        });
        expect(reloaded.contextVersion).toBeGreaterThan(session.contextVersion);
    });

    test('binds confirmation tokens to session context and prevents replay', async () => {
        const session = await resolveAssistantSession({ context: {} });
        const actionId = createActionId({
            intent: 'cart_action',
            entities: {
                productId: 'iphone-15',
            },
            contextVersion: session.contextVersion + 1,
            seed: 1,
        });

        const pending = await updateAssistantSession({
            sessionId: session.sessionId,
            baseSession: session,
            patch: {
                incrementContextVersion: true,
                pendingAction: {
                    actionId,
                    actionType: 'ADD_TO_CART',
                    contextVersion: session.contextVersion + 1,
                    action: {
                        type: 'add_to_cart',
                        productId: 'iphone-15',
                    },
                },
            },
        });

        expect(await validatePendingAction({
            session: pending,
            actionId,
            contextVersion: pending.contextVersion,
        })).toMatchObject({ ok: true });

        const executed = await markActionExecuted({
            sessionId: pending.sessionId,
            baseSession: pending,
            actionId,
        });

        expect(executed.pendingAction).toBeNull();
        expect(executed.executedActionIds).toContain(actionId);
        expect(await validatePendingAction({
            session: executed,
            actionId,
            contextVersion: executed.contextVersion,
        })).toMatchObject({
            ok: false,
            reason: 'pending_action_missing',
        });
    });
});
