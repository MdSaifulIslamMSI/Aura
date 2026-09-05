import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import SupportSection from './SupportSection';

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
}

const apiMocks = vi.hoisted(() => ({
    getTickets: vi.fn(),
    getMessages: vi.fn(),
    createTicket: vi.fn(),
    sendMessage: vi.fn(),
}));

vi.mock('@/context/MarketContext', () => ({
    useMarket: () => ({
        t: (_key, _values, fallback) => fallback,
        formatDateTime: (value) => new Date(value).toISOString(),
        formatNumber: (value) => String(value),
    }),
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
    useStableIcuMessages: (translate) => translate || ((_key, _values = {}, fallback = '') => fallback),
}));

vi.mock('@/context/SocketContext', () => ({
    useSocketDemand: () => {},
    useSocket: () => ({ socket: null, isConnected: false, connectionState: 'polling' }),
}));

vi.mock('@/context/VideoCallContext', () => ({
    useVideoCall: () => ({ callStatus: 'idle', activeCallContext: null, joinSupportCall: vi.fn() }),
}));

vi.mock('@/hooks/useSpeechInput', () => ({
    useSpeechInput: () => ({
        isListening: false,
        supportsSpeechInput: false,
        stopListening: vi.fn(),
        toggleListening: vi.fn(),
    }),
}));

vi.mock('@/hooks/useDynamicTranslations', () => ({
    useDynamicTranslations: () => ({ translateText: (value) => value }),
}));

vi.mock('@/services/api', () => ({
    supportApi: {
        getTickets: apiMocks.getTickets,
        getMessages: apiMocks.getMessages,
        createTicket: apiMocks.createTicket,
        sendMessage: apiMocks.sendMessage,
    },
}));

vi.mock('@/components/features/support/SupportArchitecturePanel', () => ({
    default: () => null,
}));

vi.mock('@/components/features/support/SupportSpeechButton', () => ({
    default: () => null,
}));

vi.mock('@/hooks/useActiveWindowRefresh', () => ({
    useActiveWindowRefresh: () => {},
}));

const renderSection = (props = {}) => render(
    <MemoryRouter>
        <SupportSection profile={{ accountState: 'active' }} {...props} />
    </MemoryRouter>
);

describe('SupportSection conversation shell', () => {
    it('renders the inbox and an empty ticket list without crashing', async () => {
        apiMocks.getTickets.mockResolvedValue({ data: [] });
        apiMocks.getMessages.mockResolvedValue({ data: [] });

        renderSection();

        expect(await screen.findByText('Chat with Aura Support')).toBeInTheDocument();
        expect(await screen.findByText('No chats yet')).toBeInTheDocument();
    });

    it('lists fetched tickets and selects one on click', async () => {
        apiMocks.getTickets.mockResolvedValue({
            data: [{
                _id: 'ticket-1',
                subject: 'Where is my order',
                category: 'order_issue',
                status: 'open',
                priority: 'normal',
                unreadByUser: 1,
                lastMessageAt: new Date().toISOString(),
            }],
        });
        apiMocks.getMessages.mockResolvedValue({ data: [] });

        renderSection();

        const inboxEntry = await screen.findByRole('button', { name: /where is my order/i });
        fireEvent.click(inboxEntry);

        await waitFor(() => {
            expect(apiMocks.getMessages).toHaveBeenCalledWith('ticket-1');
        });
    });

    it('gives the thread composer an accessible name', async () => {
        apiMocks.getTickets.mockResolvedValue({
            data: [{
                _id: 'ticket-1',
                subject: 'Where is my order',
                category: 'order_issue',
                status: 'open',
                priority: 'normal',
                unreadByUser: 0,
                lastMessageAt: new Date().toISOString(),
            }],
        });
        apiMocks.getMessages.mockResolvedValue({ data: [] });

        renderSection();

        fireEvent.click(await screen.findByRole('button', { name: /where is my order/i }));

        expect(await screen.findByRole('textbox', { name: 'Support message' })).toBeInTheDocument();
    });

    it('renders the resolution summary without crashing', async () => {
        apiMocks.getTickets.mockResolvedValue({
            data: [{
                _id: 'ticket-1',
                subject: 'Where is my order',
                category: 'order_issue',
                status: 'resolved',
                priority: 'normal',
                unreadByUser: 0,
                resolutionSummary: 'Refund issued to original payment method',
                lastMessageAt: new Date().toISOString(),
            }],
        });
        apiMocks.getMessages.mockResolvedValue({ data: [] });

        renderSection();

        fireEvent.click(await screen.findByRole('button', { name: /where is my order/i }));

        expect(await screen.findByText('Resolution summary')).toBeInTheDocument();
        expect(await screen.findByText(/Refund issued to original payment method/)).toBeInTheDocument();
    });

    it('opens the compose form from the New chat button', async () => {
        apiMocks.getTickets.mockResolvedValue({ data: [] });
        apiMocks.getMessages.mockResolvedValue({ data: [] });

        renderSection();

        fireEvent.click(await screen.findByText('New chat'));

        expect(await screen.findByText('Start a support conversation')).toBeInTheDocument();
    });
});
