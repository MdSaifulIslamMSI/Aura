import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminSupport from './Support';
import { supportApi } from '@/services/api/supportApi';
import { ColorModeProvider } from '@/context/ColorModeContext';
import { MarketProvider } from '@/context/MarketContext';

const socketHandlers = new Map();
const socketMock = {
    on: vi.fn((eventName, handler) => {
        socketHandlers.set(eventName, handler);
    }),
    off: vi.fn((eventName, handler) => {
        if (socketHandlers.get(eventName) === handler) {
            socketHandlers.delete(eventName);
        }
    }),
};

const emitSocket = async (eventName, payload) => {
    const handler = socketHandlers.get(eventName);
    if (!handler) {
        throw new Error(`Missing socket handler for ${eventName}`);
    }

    await act(async () => {
        handler(payload);
    });
};

vi.mock('@/services/api/supportApi', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        supportApi: {
            ...actual.supportApi,
            adminGetTickets: vi.fn(),
            getMessages: vi.fn(),
            sendMessage: vi.fn(),
            adminUpdateStatus: vi.fn(),
        },
    };
});

vi.mock('@/context/SocketContext', () => ({
    useSocket: () => ({
        socket: socketMock,
        isConnected: true,
    }),
    useSocketDemand: vi.fn(),
}));

vi.mock('@/context/VideoCallContext', () => ({
    useVideoCall: () => ({
        startCall: vi.fn().mockResolvedValue(true),
        callStatus: 'idle',
        activeCallContext: null,
    }),
}));

describe('AdminSupport', () => {
    const renderAdminSupport = () => render(
        <MemoryRouter initialEntries={['/admin/support']}>
            <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
                <ColorModeProvider>
                    <AdminSupport />
                </ColorModeProvider>
            </MarketProvider>
        </MemoryRouter>
    );

    beforeEach(() => {
        vi.clearAllMocks();
        socketHandlers.clear();
        HTMLElement.prototype.scrollIntoView = vi.fn();
    });

    it('adds live incoming support tickets to the admin queue', async () => {
        supportApi.adminGetTickets.mockResolvedValue({ data: [] });
        supportApi.getMessages.mockResolvedValue({ data: [] });

        renderAdminSupport();

        expect(await screen.findByText('No tickets found')).toBeInTheDocument();

        await emitSocket('support:ticket:new', {
            ticket: {
                _id: 'ticket-1',
                subject: 'Appeal for suspension review',
                category: 'moderation_appeal',
                status: 'open',
                unreadByAdmin: 1,
                lastMessageAt: '2026-03-18T10:00:00.000Z',
                lastMessagePreview: 'Please review my case again.',
                user: {
                    _id: 'user-1',
                    email: 'buyer@example.com',
                    name: 'Buyer One',
                    accountState: 'suspended',
                },
            },
        });

        expect((await screen.findAllByText('Appeal for suspension review')).length).toBeGreaterThan(0);
        expect(screen.getAllByText('buyer@example.com').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Please review my case again.').length).toBeGreaterThan(0);
        expect(supportApi.getMessages).toHaveBeenCalledWith('ticket-1');
    });

    it('syncs the active conversation from live admin support message events', async () => {
        const initialTicket = {
            _id: 'ticket-9',
            subject: 'Order support needed',
            category: 'order_issue',
            status: 'open',
            unreadByAdmin: 0,
            lastMessageAt: '2026-03-18T10:00:00.000Z',
            lastMessagePreview: 'Original issue',
            user: {
                _id: 'user-9',
                email: 'shopper@example.com',
                name: 'Shopper Nine',
                accountState: 'active',
            },
        };
        const initialMessages = [
            {
                _id: 'msg-1',
                text: 'Original issue',
                isAdmin: false,
                isSystem: false,
                sentAt: '2026-03-18T10:00:00.000Z',
                sender: { name: 'Shopper Nine', email: 'shopper@example.com' },
            },
        ];
        const liveMessage = {
            _id: 'msg-2',
            text: 'Need human help right now',
            isAdmin: false,
            isSystem: false,
            sentAt: '2026-03-18T10:05:00.000Z',
            sender: { name: 'Shopper Nine', email: 'shopper@example.com' },
        };

        supportApi.adminGetTickets.mockResolvedValue({ data: [initialTicket] });
        supportApi.getMessages
            .mockResolvedValueOnce({ data: initialMessages })
            .mockResolvedValueOnce({ data: [...initialMessages, liveMessage] });

        renderAdminSupport();

        expect((await screen.findAllByText('Order support needed')).length).toBeGreaterThan(0);
        expect((await screen.findAllByText('Original issue')).length).toBeGreaterThan(0);

        await emitSocket('support:message:new', {
            ticketId: 'ticket-9',
            ticket: {
                ...initialTicket,
                unreadByAdmin: 1,
                lastMessageAt: '2026-03-18T10:05:00.000Z',
                lastMessagePreview: 'Need human help right now',
            },
            message: liveMessage,
        });

        await waitFor(() => {
            expect(screen.getAllByText('Need human help right now').length).toBeGreaterThan(0);
        });

        expect(supportApi.getMessages).toHaveBeenCalledTimes(2);
    });
});
