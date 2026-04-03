import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearAssistantWorkspaceState,
    readAssistantWorkspaceState,
    writeAssistantWorkspaceState,
} from './assistantSessionStorage';

describe('assistantSessionStorage', () => {
    beforeEach(() => {
        window.sessionStorage.clear();
    });

    it('returns a clean default state when nothing is stored', () => {
        expect(readAssistantWorkspaceState()).toEqual({
            sessionId: '',
            draft: '',
        });
    });

    it('writes only the ephemeral session id and draft', () => {
        const stored = writeAssistantWorkspaceState({
            sessionId: ' session-42 ',
            draft: 'compare these phones',
            ignored: 'value',
        });

        expect(stored).toEqual({
            sessionId: 'session-42',
            draft: 'compare these phones',
            ignored: 'value',
        });
        expect(readAssistantWorkspaceState()).toEqual({
            sessionId: 'session-42',
            draft: 'compare these phones',
        });
    });

    it('recovers safely from malformed session storage', () => {
        window.sessionStorage.setItem('aura_assistant_workspace_v2', '{not-json');

        expect(readAssistantWorkspaceState()).toEqual({
            sessionId: '',
            draft: '',
        });
    });

    it('clears the saved workspace state', () => {
        writeAssistantWorkspaceState({
            sessionId: 'session-7',
            draft: 'cart review',
        });

        clearAssistantWorkspaceState();

        expect(readAssistantWorkspaceState()).toEqual({
            sessionId: '',
            draft: '',
        });
    });
});
