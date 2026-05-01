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

    test('detectRoute keeps greetings GENERAL even when stale product context exists', () => {
        const result = __testables.detectRoute({
            message: 'hello',
            context: {
                currentProductId: '400047506',
                candidateProductIds: ['400047506'],
            },
            assistantSession: {
                lastIntent: 'product_search',
                lastResults: [{ id: 400047506, title: 'Dell XPS 13', category: 'Electronics' }],
            },
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

    test('detectRoute keeps short refinement follow-ups in commerce when there is recent shopping context', () => {
        const result = __testables.detectRoute({
            message: 'no in fashion section',
            assistantSession: {
                lastIntent: 'product_search',
                lastResults: [{ id: 101 }],
            },
        });

        expect(result.route).toBe(ROUTE_ECOMMERCE);
    });

    test('detectRoute keeps comparison follow-ups in commerce when there are recent results', () => {
        const result = __testables.detectRoute({
            message: 'which one has the best rating and why',
            assistantSession: {
                lastIntent: 'product_search',
                lastResults: [{ id: 101, title: 'Phone A', rating: 4.9 }],
            },
        });

        expect(result.route).toBe(ROUTE_ECOMMERCE);
    });

    test('detectRoute chooses ACTION for direct navigation flows like go to cart', () => {
        const result = __testables.detectRoute({
            message: 'go to cart',
        });

        expect(result.route).toBe(ROUTE_ACTION);
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

    test('buildCommerceResponseText adds deterministic grounded shopping structure', () => {
        const result = __testables.buildCommerceResponseText({
            answer: 'Dell Inspiron 14 is the strongest value pick.',
            products: [{
                id: 400047506,
                title: 'Dell Inspiron 14',
                brand: 'Dell',
                category: 'Laptops',
                price: 49999,
                stock: 5,
                rating: 4.4,
                ratingCount: 127,
                discountPercentage: 14,
            }],
            filters: {
                category: 'Laptops',
                maxPrice: 50000,
            },
        });

        expect(result).toContain('Dell Inspiron 14 is the strongest value pick.');
        expect(result).toContain('**Decision signals**');
        expect(result).toContain('Applied: category Laptops; under Rs 50,000.');
        expect(result).toContain('Shortlist: 1 verified result, Rs 49,999-Rs 49,999; 1/1 in stock.');
        expect(result).toContain('**Grounded picks**');
        expect(result).toContain('Best fit: Dell Inspiron 14 by Dell - Rs 49,999');
        expect(result).toContain('within Rs 50,000');
        expect(result).toContain('**Next step**');
    });

    test('buildCommerceResponseText labels relaxed alternatives without hiding original filters', () => {
        const result = __testables.buildCommerceResponseText({
            answer: 'This is the nearest verified option.',
            products: [{
                id: 51,
                title: 'Cotton Shirt',
                brand: 'Aura Basics',
                category: "Men's Fashion",
                price: 1299,
                stock: 4,
                rating: 4.2,
            }],
            filters: {
                category: 'Fashion',
                maxPrice: 1000,
            },
            relaxation: {
                reason: 'relaxed_budget',
                label: 'budget above Rs 1,000',
            },
        });

        expect(result).toContain('No exact catalog match for category Fashion; under Rs 1,000');
        expect(result).toContain('Relaxed: budget above Rs 1,000');
        expect(result).toContain('watch: above Rs 1,000');
    });

    test('inferStructuredRetrievalFilters pulls hard commerce constraints from the user message', () => {
        expect(__testables.inferStructuredRetrievalFilters({
            message: 'show me top rated phones under 15000 in stock',
        })).toEqual({
            category: 'Mobiles',
            brand: '',
            minPrice: 0,
            maxPrice: 15000,
            minRating: 0,
            inStock: true,
            sortBy: 'rating_desc',
            requiredTerms: [],
        });
    });

    test('inferStructuredRetrievalFilters captures color and spec terms as must-have attributes', () => {
        expect(__testables.inferStructuredRetrievalFilters({
            message: 'show me blue shoes with 16gb ram under 2000',
        })).toEqual({
            category: 'Footwear',
            brand: '',
            minPrice: 0,
            maxPrice: 2000,
            minRating: 0,
            inStock: null,
            sortBy: '',
            requiredTerms: ['blue', '16 gb', 'ram'],
        });
    });

    test('inferStructuredRetrievalFilters treats explicit fashion as a fresh category, not stale electronics', () => {
        expect(__testables.inferStructuredRetrievalFilters({
            message: 'show me fashion product',
            assistantSession: {
                lastEntities: {
                    category: 'Electronics',
                },
            },
        })).toEqual({
            category: 'Fashion',
            brand: '',
            minPrice: 0,
            maxPrice: 0,
            minRating: 0,
            inStock: null,
            sortBy: '',
            requiredTerms: [],
        });
    });

    test('matchesRetrievalFilters blocks electronics when the user asked for fashion', () => {
        expect(__testables.matchesRetrievalFilters({
            title: 'Dell XPS 13 9300 Laptop',
            brand: 'Dell',
            category: 'Electronics',
            price: 16563,
            stock: 2,
            rating: 4.7,
        }, {
            category: 'Fashion',
        })).toBe(false);
    });

    test('matchesRetrievalFilters lets generic fashion match gendered fashion categories', () => {
        expect(__testables.matchesRetrievalFilters({
            title: 'Printed cotton kurta',
            brand: 'Aura',
            category: "Women's Fashion",
            price: 999,
            stock: 3,
            rating: 4.3,
        }, {
            category: 'Fashion',
        })).toBe(true);
    });

    test('sortCommerceEntries promotes the best grounded fit over raw retrieval score', () => {
        const result = __testables.sortCommerceEntries([{
            score: 0.3,
            product: {
                id: 1,
                title: 'Budget Cotton Shirt',
                category: "Men's Fashion",
                price: 899,
                stock: 5,
                rating: 4.6,
                ratingCount: 80,
            },
        }, {
            score: 0.8,
            product: {
                id: 2,
                title: 'Out of Stock Designer Shirt',
                category: "Men's Fashion",
                price: 2400,
                stock: 0,
                rating: 3.2,
                ratingCount: 4,
            },
        }], {
            category: 'Fashion',
            maxPrice: 1000,
            inStock: true,
        });

        expect(result[0].product.id).toBe(1);
    });

    test('buildRelaxedRetrievalPlans relaxes tight constraints without dropping the category', () => {
        const plans = __testables.buildRelaxedRetrievalPlans({
            query: 'fashion products',
            filters: {
                category: 'Fashion',
                maxPrice: 500,
                inStock: true,
                requiredTerms: ['cotton'],
            },
        });

        expect(plans).toEqual(expect.arrayContaining([
            expect.objectContaining({
                reason: 'relaxed_budget',
                filters: expect.objectContaining({
                    category: 'Fashion',
                    maxPrice: 0,
                }),
            }),
            expect.objectContaining({
                reason: 'relaxed_stock',
                filters: expect.objectContaining({
                    category: 'Fashion',
                    inStock: null,
                }),
            }),
        ]));
        expect(plans.every((plan) => plan.filters.category === 'Fashion')).toBe(true);
    });

    test('buildNoResultResponseText refuses unrelated product filler', () => {
        const result = __testables.buildNoResultResponseText({
            query: 'fashion products',
            filters: {
                category: 'Fashion',
                maxPrice: 500,
            },
        });

        expect(result).toContain('category Fashion; under Rs 500');
        expect(result).toContain('I will not fill the gap with unrelated products.');
    });

    test('validateRetrievalQueryPayload keeps structured filters for the retriever', () => {
        const result = __testables.validateRetrievalQueryPayload({
            query: 'mens fashion shirt',
            category: "Men's Fashion",
            maxPrice: 2000,
            inStock: true,
            sortBy: 'price_asc',
        });

        expect(result).toEqual({
            ok: true,
            data: {
                query: 'mens fashion shirt',
                filters: {
                    category: "Men's Fashion",
                    brand: '',
                    minPrice: 0,
                    maxPrice: 2000,
                    minRating: 0,
                    inStock: true,
                    sortBy: 'price_asc',
                    requiredTerms: [],
                },
                followUps: [],
            },
        });
    });

    test('deriveRetrievalQuery turns a category-only refinement into a direct commerce query', async () => {
        const result = await __testables.deriveRetrievalQuery({
            message: 'no in fashion section',
            assistantSession: {
                lastIntent: 'product_search',
                lastEntities: { query: 'good products' },
                lastResults: [{ id: 101, title: 'Laptop', category: 'Electronics' }],
            },
            conversationHistory: [{ role: 'assistant', content: 'I found some laptops.' }],
        });

        expect(result).toEqual({
            query: 'fashion products',
            provider: '',
            providerModel: '',
            filters: {
                category: 'Fashion',
                brand: '',
                minPrice: 0,
                maxPrice: 0,
                minRating: 0,
                inStock: null,
                sortBy: '',
                requiredTerms: [],
            },
            validator: { ok: true, reason: 'category_hint_query' },
        });
    });

    test('shouldReuseSessionResultsForCommerce stays true for comparison-style follow-ups', () => {
        expect(__testables.shouldReuseSessionResultsForCommerce({
            message: 'which one is better for battery and rating',
            assistantSession: {
                lastResults: [{ id: 101, title: 'Phone A' }, { id: 102, title: 'Phone B' }],
            },
        })).toBe(true);
    });

    test('resolveActionPlan keeps generic support requests detached from a latest order by default', async () => {
        const result = await __testables.resolveActionPlan({
            message: 'any support',
            user: null,
            context: {},
        });

        expect(result).toEqual({
            type: 'open_support',
            orderId: '',
            prefill: {
                subject: 'Customer support request',
                category: 'general_help',
                body: 'any support',
            },
            requiresConfirmation: false,
        });
    });
});
