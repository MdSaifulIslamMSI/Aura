import { describe, expect, it, vi } from 'vitest';
import {
    buildLocalVoiceCommand,
    extractAssistantBudget,
    findAssistantCategory,
    findAssistantNavigationTarget,
    normalizeAssistantText,
    parseClientAssistantIntent,
    parseSemanticSearchIntent,
} from './assistantIntent';

describe('normalizeAssistantText', () => {
    it('lowercases, strips punctuation, and collapses whitespace', () => {
        expect(normalizeAssistantText('  Show me LAPTOPS!!  ')).toBe('show me laptops');
    });
});

describe('findAssistantCategory', () => {
    it('maps aliases to canonical category values', () => {
        expect(findAssistantCategory('looking for a macbook pro')?.value).toBe('laptops');
        expect(findAssistantCategory('gaming console deals')?.value).toBe('gaming');
    });

    it('covers fashion, footwear, and home-kitchen catalog categories', () => {
        expect(findAssistantCategory('go to shoes category')?.value).toBe('footwear');
        expect(findAssistantCategory('show fashion deals')?.value).toBe('mens-fashion');
        expect(findAssistantCategory('home appliances deals')?.value).toBe('home-kitchen');
    });

    it('returns null when no category alias is present', () => {
        expect(findAssistantCategory('hello there')).toBeNull();
        expect(findAssistantCategory('')).toBeNull();
    });

    it('does not match substrings inside longer words', () => {
        expect(findAssistantCategory('telephone exchange')?.value ?? null).not.toBe('mobiles');
    });
});

describe('findAssistantNavigationTarget', () => {
    it('resolves page aliases to routes', () => {
        expect(findAssistantNavigationTarget('open my bag')?.path).toBe('/cart');
        expect(findAssistantNavigationTarget('show favourites')?.path).toBe('/wishlist');
    });

    it('returns null for unrecognized pages', () => {
        expect(findAssistantNavigationTarget('open the garage')).toBeNull();
    });
});

describe('extractAssistantBudget', () => {
    it('parses "under", rupee, and k-suffixed budgets', () => {
        expect(extractAssistantBudget('laptops under 20k')).toBe(20000);
        expect(extractAssistantBudget('rs 15,000 phone')).toBe(15000);
        expect(extractAssistantBudget('show phones below 50000')).toBe(50000);
    });

    it('returns 0 when no budget is expressed', () => {
        expect(extractAssistantBudget('best phone please')).toBe(0);
        expect(extractAssistantBudget('')).toBe(0);
    });
});

describe('parseClientAssistantIntent', () => {
    it('reports general knowledge with zero confidence for empty input', () => {
        expect(parseClientAssistantIntent('')).toEqual({ intent: 'general_knowledge', confidence: 0, entities: {} });
    });

    it('classifies help and close commands', () => {
        expect(parseClientAssistantIntent('what can you do').action).toEqual({ type: 'help' });
        const close = parseClientAssistantIntent('close the assistant');
        expect(close.intent).toBe('navigation');
        expect(close.action).toEqual({ type: 'close' });
    });

    it('routes checkout and support phrasing', () => {
        expect(parseClientAssistantIntent('pay now').intent).toBe('checkout');
        expect(parseClientAssistantIntent('where is my refund?').intent).toBe('support');
        expect(parseClientAssistantIntent('cancel my order').intent).toBe('support');
        expect(parseClientAssistantIntent('help with delayed order').intent).toBe('support');
    });

    it('does not hijack nav substrings inside commerce searches', () => {
        expect(parseClientAssistantIntent('show me garbage bags under 500').intent).toBe('product_search');
        expect(parseClientAssistantIntent('compare iphones under 50000').intent).toBe('product_search');
    });

    it('does not invent product ids from ordinary words', () => {
        expect(parseClientAssistantIntent('show product recommendations').intent).not.toBe('product_selection');
    });

    it('parses star-rating phrasing variants', () => {
        expect(parseClientAssistantIntent('phones with 4 stars and up').entities.rating).toBe(4);
        expect(parseClientAssistantIntent('laptops rated 4.5').entities.rating).toBe(4.5);
        expect(parseClientAssistantIntent('mobiles 4+ stars').entities.rating).toBe(4);
    });

    it('strips full budget expressions from the search query', () => {
        expect(parseClientAssistantIntent('find phones under 50000').entities.query).not.toMatch(/50000/);
        expect(parseClientAssistantIntent('phones under rs 15,000').entities.query).not.toMatch(/15,?000/);
    });

    it('navigates to pages via open/show phrasing', () => {
        const intent = parseClientAssistantIntent('open my cart');
        expect(intent.intent).toBe('navigation');
        expect(intent.action.path).toBe('/cart');
    });

    it('browses categories only without search signals', () => {
        const browse = parseClientAssistantIntent('go to laptops category');
        expect(browse.intent).toBe('navigation');
        expect(browse.action.path).toBe('/category/laptops');

        // "search" wording flips the same category into a product search.
        const search = parseClientAssistantIntent('search laptops');
        expect(search.intent).toBe('product_search');
        expect(search.entities.category).toBe('laptops');
    });

    it('detects product selection by id', () => {
        const intent = parseClientAssistantIntent('open product itm-42');
        expect(intent.intent).toBe('product_selection');
        expect(intent.action).toEqual({ type: 'open_product', productId: 'itm-42' });
    });

    it('extracts search filters from natural phrasing', () => {
        const intent = parseClientAssistantIntent('find mobiles under 50k rating 4+ in stock fast delivery');
        expect(intent.intent).toBe('product_search');
        expect(intent.entities.category).toBe('mobiles');
        expect(intent.entities.maxPrice).toBe(50000);
        expect(intent.entities.rating).toBe(4);
        expect(intent.entities.inStock).toBe('true');
        expect(intent.entities.deliveryTime).toBe('1-2 days');
        expect(intent.action.type).toBe('search');
    });

    it('falls back to general knowledge for ordinary questions', () => {
        // "telephone" would alias-match the mobiles category, so use a neutral question.
        const intent = parseClientAssistantIntent('what is the capital of japan');
        expect(intent).toMatchObject({ intent: 'general_knowledge', confidence: 0.55, entities: {} });
    });
});

describe('parseSemanticSearchIntent', () => {
    it('only accepts product-search intents and maps entities', () => {
        const parsed = parseSemanticSearchIntent('search for bluetooth gadgets under 3k');
        expect(parsed).toMatchObject({ category: 'electronics', maxPrice: 3000 });
        expect(parsed.query).toContain('gadgets');
        expect(parsed.query).not.toContain('under 3k');

        expect(parseSemanticSearchIntent('open my cart')).toBeNull();
        expect(parseSemanticSearchIntent('')).toBeNull();
    });
});

describe('buildLocalVoiceCommand', () => {
    it('builds close, product, navigate, search, and help commands', () => {
        expect(buildLocalVoiceCommand('exit')).toMatchObject({ type: 'close', message: 'Closing voice assistant.' });
        expect(buildLocalVoiceCommand('open product itm-42')).toEqual({
            type: 'product',
            productId: 'itm-42',
            message: 'Opening product itm-42.',
        });
        expect(buildLocalVoiceCommand('open my wishlist')).toMatchObject({
            type: 'navigate',
            path: '/wishlist',
            message: 'Opening Wishlist.',
        });
        expect(buildLocalVoiceCommand('search gaming laptops')).toMatchObject({ type: 'search' });
        // Non-actionable chatter is treated as a help opportunity...
        expect(buildLocalVoiceCommand('mm hmm').type).toBe('help');
        // ...while checkout/support now resolve to safe navigation targets.
        expect(buildLocalVoiceCommand('pay now')).toMatchObject({ type: 'navigate', path: '/checkout' });
    });

    it('prefers a provided formatMessage for user-facing strings', () => {
        const formatMessage = vi.fn((descriptor, values) => (
            values ? `Localized ${descriptor.id}: ${values.productId}` : descriptor.defaultMessage
        ));

        const command = buildLocalVoiceCommand('open product itm-42', { formatMessage });
        expect(formatMessage).toHaveBeenCalled();
        expect(command.message).toBe('Localized assistant.intent.voice.openingProduct: itm-42');
    });

    it('interpolates defaults locally when formatMessage throws', () => {
        const command = buildLocalVoiceCommand('close', { formatMessage: () => { throw new Error('boom'); } });
        expect(command.message).toBe('Closing voice assistant.');
    });
});
