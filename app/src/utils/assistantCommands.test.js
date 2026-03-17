import { describe, expect, it } from 'vitest';
import {
    buildAssistantRequestPayload,
    buildLocalAssistantResponse,
    getAssistantRouteLabel,
    parseAssistantCommand,
} from './assistantCommands';

describe('assistantCommands', () => {
    it('parses direct navigation commands', () => {
        expect(parseAssistantCommand('open marketplace')).toMatchObject({
            type: 'navigate',
            path: '/marketplace',
        });
    });

    it('parses search-style commands', () => {
        expect(parseAssistantCommand('search for wireless earbuds')).toMatchObject({
            type: 'search',
            query: 'wireless earbuds',
        });
    });

    it('keeps general prompts in chat mode instead of forcing catalog search', () => {
        expect(parseAssistantCommand('Which phone is better for camera and battery life?')).toMatchObject({
            type: 'chat',
            message: 'Which phone is better for camera and battery life?',
        });
    });

    it('does not auto-execute explicit search prompts locally', () => {
        expect(buildLocalAssistantResponse('search for wireless earbuds')).toMatchObject({
            local: false,
            actions: [{ type: 'search', query: 'wireless earbuds', reason: 'guided_search' }],
        });
    });

    it('builds local responses for instant voice assistant launch', () => {
        expect(buildLocalAssistantResponse('open voice assistant')).toMatchObject({
            local: true,
            autoExecute: true,
            actions: [{ type: 'open_voice_assistant', reason: 'voice_requested' }],
        });
    });

    it('builds compare payloads from recent products when enough context exists', () => {
        const payload = buildAssistantRequestPayload({
            message: 'compare the strongest recent picks',
            selectedMode: 'compare',
            pathname: '/products',
            latestProducts: [
                { id: 101, category: 'mobiles', brand: 'Apple' },
                { id: 202, category: 'mobiles', brand: 'Samsung' },
            ],
        });

        expect(payload.assistantMode).toBe('compare');
        expect(payload.context.productIds).toEqual(['101', '202']);
    });

    it('builds bundle payloads with inferred budget and theme', () => {
        const payload = buildAssistantRequestPayload({
            message: 'build a gaming setup under Rs 80000',
            selectedMode: 'bundle',
            pathname: '/',
            latestProducts: [],
        });

        expect(payload.assistantMode).toBe('bundle');
        expect(payload.context.budget).toBe(80000);
        expect(payload.context.theme).toBe('gaming setup');
    });

    it('returns route-aware labels for supported surfaces', () => {
        expect(getAssistantRouteLabel('/marketplace')).toBe('Marketplace scouting');
        expect(getAssistantRouteLabel('/')).toBe('Home command deck');
    });
});
