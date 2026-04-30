import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { MarketProvider } from '@/context/MarketContext';
import { AuthContext } from '@/context/AuthContext';
import Orders, { OrderCard } from './index';

vi.mock('@/services/api', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        orderApi: {
            ...actual.orderApi,
            getMyOrders: vi.fn(),
            getOrderTimeline: vi.fn(),
            getCommandCenter: vi.fn(),
            cancelOrder: vi.fn(),
            requestRefund: vi.fn(),
            requestReplacement: vi.fn(),
            sendSupportMessage: vi.fn(),
            createWarrantyClaim: vi.fn(),
        },
    };
});

import { orderApi } from '@/services/api';

const baseOrder = {
    _id: '65f1f0f0f0f0f0f0f0f0f0f0',
    createdAt: '2026-03-20T10:00:00.000Z',
    totalPrice: 4752,
    paymentMethod: 'CARD',
    paymentProvider: 'razorpay',
    paymentIntentId: 'pi_order_test_123456',
    paymentState: 'authorized',
    paymentAuthorizedAt: '2026-03-20T10:04:00.000Z',
    orderStatus: 'processing',
    isDelivered: false,
    isPaid: true,
    shippingAddress: {
        address: '42 Orbit Lane',
        city: 'Bengaluru',
        postalCode: '560001',
        country: 'India',
    },
    orderItems: [
        {
            title: 'Aura Device',
            quantity: 1,
            image: 'https://example.com/device.png',
            price: 4752,
            product: '65f1f0f0f0f0f0f0f0f0f0aa',
        },
    ],
};

describe('OrderCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('settles trust timeline and command center requests after expansion', async () => {
        orderApi.getOrderTimeline.mockResolvedValue({
            timeline: [
                {
                    at: '2026-03-20T10:05:00.000Z',
                    stage: 'payment',
                    type: 'payment_confirmed',
                    title: 'Payment Confirmed',
                    detail: 'Order marked as paid.',
                    severity: 'ok',
                },
            ],
        });

        orderApi.getCommandCenter.mockResolvedValue({
            commandCenter: {
                refunds: [],
                replacements: [],
                supportChats: [],
                warrantyClaims: [],
                lastUpdatedAt: null,
            },
        });

        render(
            <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
                <OrderCard order={baseOrder} />
            </MarketProvider>
        );

        fireEvent.click(screen.getByText(/Order ID:/i));

        expect(screen.getByText(/Loading trust events/i)).toBeInTheDocument();
        expect(screen.getByText(/Loading command center/i)).toBeInTheDocument();

        await waitFor(() => {
            expect(orderApi.getOrderTimeline).toHaveBeenCalledTimes(1);
            expect(orderApi.getCommandCenter).toHaveBeenCalledTimes(1);
        });

        await waitFor(() => {
            expect(screen.queryByText(/Loading trust events/i)).not.toBeInTheDocument();
            expect(screen.queryByText(/Loading command center/i)).not.toBeInTheDocument();
        });

        expect(screen.getByText('Payment Confirmed')).toBeInTheDocument();
        expect(screen.getByText('Payment Timeline')).toBeInTheDocument();
        expect(screen.getByText('Authorization')).toBeInTheDocument();
        expect(screen.getByText('Capture and Settlement')).toBeInTheDocument();
        expect(screen.getByText(/Capture is pending in the backend queue/i)).toBeInTheDocument();
        expect(screen.getByText('Refund Requests')).toBeInTheDocument();
        expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    });
});

describe('Orders page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('refreshes the order list when the app regains focus', async () => {
        orderApi.getMyOrders.mockResolvedValue([baseOrder]);

        render(
            <MemoryRouter>
                <AuthContext.Provider value={{ currentUser: { uid: 'user-1', email: 'user@example.com' } }}>
                    <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
                        <Orders />
                    </MarketProvider>
                </AuthContext.Provider>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(orderApi.getMyOrders).toHaveBeenCalledTimes(1);
            expect(screen.getByText(/Order History/i)).toBeInTheDocument();
        });

        fireEvent(
            window,
            new Event('focus')
        );

        await waitFor(() => {
            expect(orderApi.getMyOrders).toHaveBeenCalledTimes(2);
        });
    });
});
