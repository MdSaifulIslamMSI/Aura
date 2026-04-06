const { __testables, ROUTE_ACTION, ROUTE_ECOMMERCE, ROUTE_GENERAL } = require('../services/ai/commerceAssistantService');

describe('commerceAssistantService helpers', () => {
    test('detectRoute chooses ACTION for explicit action requests', () => {
        const result = __testables.detectRoute({
            actionRequest: {
                type: 'checkout',
            },
        });

        expect(result.route).toBe(ROUTE_ACTION);
    });

    test('detectRoute chooses ECOMMERCE for product queries', () => {
        const result = __testables.detectRoute({
            message: 'show me phones under 30000',
        });

        expect(result.route).toBe(ROUTE_ECOMMERCE);
    });

    test('detectRoute chooses ECOMMERCE for plural commerce queries', () => {
        const result = __testables.detectRoute({
            message: 'show me dell laptops around 50000 rupees',
        });

        expect(result.route).toBe(ROUTE_ECOMMERCE);
    });

    test('detectRoute falls back to GENERAL for generic prompts', () => {
        const result = __testables.detectRoute({
            message: 'write a short thank you note',
        });

        expect(result.route).toBe(ROUTE_GENERAL);
    });

    test('detectRoute uses ECOMMERCE when media is attached', () => {
        const result = __testables.detectRoute({
            message: '',
            images: [{ dataUrl: 'data:image/png;base64,AAA' }],
        });

        expect(result.route).toBe(ROUTE_ECOMMERCE);
    });

    test('inferConfirmationFromMessage turns yes into a pending action approval', () => {
        const result = __testables.inferConfirmationFromMessage({
            message: 'yes, continue',
            assistantSession: {
                pendingAction: {
                    actionId: 'token-123',
                    contextVersion: 2,
                },
            },
        });

        expect(result).toEqual({
            actionId: 'token-123',
            approved: true,
            contextVersion: 2,
        });
    });

    test('buildActionContext reuses the active product from assistant session state', () => {
        const result = __testables.buildActionContext({
            context: {},
            assistantSession: {
                activeProduct: { id: 400000356 },
                lastResults: [{ id: 400000356 }, { id: 400000102 }],
            },
        });

        expect(result).toEqual({
            currentProductId: '400000356',
            candidateProductIds: ['400000356', '400000102'],
        });
    });

    test('isHostedGemmaAudioUnsupported detects text-and-image only hosted Gemma models', () => {
        expect(__testables.isHostedGemmaAudioUnsupported({
            provider: 'gemini',
            apiConfigured: true,
            capabilities: {
                textInput: true,
                imageInput: true,
                audioInput: false,
            },
        }, [{ dataUrl: 'data:audio/wav;base64,AAA' }])).toBe(true);

        expect(__testables.isHostedGemmaAudioUnsupported({
            provider: 'gemini',
            apiConfigured: true,
            capabilities: {
                textInput: true,
                imageInput: true,
                audioInput: true,
            },
        }, [{ dataUrl: 'data:audio/wav;base64,AAA' }])).toBe(false);
    });

    test('isHostedGemmaAudioUnsupported stays false when the hosted Gemini path is not configured', () => {
        expect(__testables.isHostedGemmaAudioUnsupported({
            provider: 'gemini',
            apiConfigured: false,
            capabilities: {
                textInput: true,
                imageInput: true,
                audioInput: false,
            },
        }, [{ dataUrl: 'data:audio/wav;base64,AAA' }])).toBe(false);
    });

    test('extractMediaLookupHints pulls product ids and title hints from a product image URL', () => {
        const result = __testables.extractMediaLookupHints({
            images: [{
                url: 'https://cdn.example.com/product-images/laptops/new-dell-xps-13-9300-laptop.png?pid=400047506',
            }],
        });

        expect(result).toEqual({
            productIds: ['400047506'],
            imageUrls: ['https://cdn.example.com/product-images/laptops/new-dell-xps-13-9300-laptop.png?pid=400047506'],
            queryCandidates: ['dell xps 13 9300 laptop', 'laptops dell xps 13 9300 laptop'],
            titleCandidates: ['dell xps 13 9300 laptop', 'laptops dell xps 13 9300 laptop'],
        });
    });

    test('validateGeneralPayload requires a non-empty answer', () => {
        expect(__testables.validateGeneralPayload({
            answer: '',
        }).ok).toBe(false);

        expect(__testables.validateGeneralPayload({
            answer: 'string',
            followUps: ['string'],
        }).ok).toBe(false);

        expect(__testables.validateGeneralPayload({
            answer: 'Hello',
            followUps: ['Next'],
        })).toEqual({
            ok: true,
            data: {
                answer: 'Hello',
                followUps: ['Next'],
            },
        });
    });

    test('validateCommercePayload strips unknown product ids', () => {
        const result = __testables.validateCommercePayload({
            answer: 'Top picks',
            productIds: ['101', '999'],
            focusProductId: '999',
            followUps: ['Compare them'],
        }, ['101', '202']);

        expect(result.ok).toBe(true);
        expect(result.data).toEqual({
            answer: 'Top picks',
            productIds: ['101'],
            focusProductId: '101',
            followUps: ['Compare them'],
        });
        expect(result.rejectedProductIds).toEqual(['999']);
    });

    test('validateCommercePayload accepts response text and product objects while keeping grounding strict', () => {
        const result = __testables.validateCommercePayload({
            response: 'Here are the best grounded matches.',
            products: [{ id: '101' }, { id: '999' }],
            selectedProductId: '101',
            followUps: ['Compare them'],
        }, ['101', '202']);

        expect(result.ok).toBe(true);
        expect(result.data).toEqual({
            answer: 'Here are the best grounded matches.',
            productIds: ['101'],
            focusProductId: '101',
            followUps: ['Compare them'],
        });
        expect(result.rejectedProductIds).toEqual(['999']);
    });
});
