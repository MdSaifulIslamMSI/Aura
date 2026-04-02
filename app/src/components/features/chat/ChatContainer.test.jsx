import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ChatContainer from './ChatContainer';

vi.mock('./MultimodalDock', () => ({
    default: () => <div data-testid="multimodal-dock">dock</div>,
}));

const renderContainer = (props = {}) => render(
    <ChatContainer
        currentUserLabel="Md Saiful"
        modeLabel="Explore"
        routeLabel="Home"
        messages={[
            {
                id: 'assistant-welcome',
                role: 'assistant',
                text: 'Tell me what you want to buy.',
            },
        ]}
        inputRef={createRef()}
        onClose={vi.fn()}
        onSetWorkspaceVariant={vi.fn()}
        onStartFresh={vi.fn()}
        onInputChange={vi.fn()}
        onSubmit={vi.fn()}
        onToggleDictation={vi.fn()}
        onAction={vi.fn()}
        onStarterPrompt={vi.fn()}
        onSelectProduct={vi.fn()}
        onAddToCart={vi.fn()}
        onViewDetails={vi.fn()}
        onOpenSupport={vi.fn()}
        onConfirmPending={vi.fn()}
        onCancelPending={vi.fn()}
        onModifyPending={vi.fn()}
        {...props}
    />
);

describe('ChatContainer', () => {
    it('renders the Gemini-style landing state with the user greeting', () => {
        renderContainer();

        expect(screen.getByText('Hi MD')).toBeInTheDocument();
        expect(screen.getByText('Where should we start?')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Create image' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /new chat/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /close chat/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /use small workspace/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /use large workspace/i })).toBeInTheDocument();
    });

    it('fires starter prompts directly from the landing chips', () => {
        const onStarterPrompt = vi.fn();
        renderContainer({ onStarterPrompt });

        fireEvent.click(screen.getByRole('button', { name: 'Review my cart' }));

        expect(onStarterPrompt).toHaveBeenCalledWith('Review my cart and tell me the smartest next step');
    });

    it('switches workspace size modes from the header controls', () => {
        const onSetWorkspaceVariant = vi.fn();
        renderContainer({ onSetWorkspaceVariant, workspaceVariant: 'small' });

        fireEvent.click(screen.getByRole('button', { name: /use large workspace/i }));
        fireEvent.click(screen.getByRole('button', { name: /use small workspace/i }));

        expect(onSetWorkspaceVariant).toHaveBeenNthCalledWith(1, 'large');
        expect(onSetWorkspaceVariant).toHaveBeenNthCalledWith(2, 'small');
    });
});
