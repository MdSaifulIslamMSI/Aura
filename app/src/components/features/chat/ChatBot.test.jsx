import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/context/AuthContext';

const mockStoreState = {
    isOpen: false,
    mode: 'explore',
    isLoading: false,
    inputValue: '',
    messages: [],
    primaryAction: null,
    secondaryActions: [],
    open: vi.fn(),
    close: vi.fn(),
    setInputValue: vi.fn(),
    resetConversation: vi.fn(),
};

vi.mock('@/context/ColorModeContext', () => ({
    useColorMode: () => ({
        colorMode: 'neo',
    }),
}));

vi.mock('@/hooks/useSpeechInput', () => ({
    useSpeechInput: () => ({
        isListening: false,
        supportsSpeechInput: false,
        stopListening: vi.fn(),
        toggleListening: vi.fn(),
    }),
}));

vi.mock('@/store/chatStore', () => ({
    useChatStore: (selector) => selector(mockStoreState),
}));

vi.mock('./useAssistantController', () => ({
    useAssistantController: () => ({
        inputRef: { current: null },
        addProductToCart: vi.fn(),
        cancelPendingAction: vi.fn(),
        confirmPendingAction: vi.fn(),
        handleAction: vi.fn(),
        handleUserInput: vi.fn(),
        modifyPendingAction: vi.fn(),
        openSupport: vi.fn(),
        selectProduct: vi.fn(),
    }),
}));

vi.mock('./ChatContainer', () => ({
    default: () => <div data-testid="chat-container" />,
}));

import ChatBot from './ChatBot';

const renderChatBot = (initialEntry) => render(
    <MemoryRouter initialEntries={[initialEntry]}>
        <AuthContext.Provider value={{ currentUser: null }}>
            <ChatBot />
        </AuthContext.Provider>
    </MemoryRouter>
);

describe('ChatBot launcher positioning', () => {
    it('raises the closed launcher above the sticky mobile product bar', () => {
        renderChatBot('/product/101');

        const launcherShell = screen.getByRole('button', { name: /open chat/i }).parentElement;

        expect(launcherShell).toHaveClass('pb-[calc(7.25rem+env(safe-area-inset-bottom))]');
    });

    it('keeps the default inset on routes without the sticky product bar', () => {
        renderChatBot('/search?q=headphones');

        const launcherShell = screen.getByRole('button', { name: /open chat/i }).parentElement;

        expect(launcherShell).not.toHaveClass('pb-[calc(7.25rem+env(safe-area-inset-bottom))]');
    });
});
