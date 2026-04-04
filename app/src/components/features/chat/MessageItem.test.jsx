import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarketProvider } from '@/context/MarketContext';
import MessageItem from './MessageItem';

const product = {
    id: '101',
    title: 'Aura Focus Laptop',
    brand: 'Aura',
    price: 54999,
    originalPrice: 59999,
    image: '/laptop.png',
    rating: 4.5,
};

const noopProps = {
    onSelectProduct: vi.fn(),
    onAddToCart: vi.fn(),
    onViewDetails: vi.fn(),
    onOpenSupport: vi.fn(),
    onConfirmPending: vi.fn(),
    onCancelPending: vi.fn(),
    onModifyPending: vi.fn(),
};

const renderWithMarket = (ui) => render(
    <MarketProvider initialPreference={{ countryCode: 'IN', language: 'en', currency: 'INR' }}>
        {ui}
    </MarketProvider>
);

describe('MessageItem', () => {
    it('renders product cards for product result messages', () => {
        renderWithMarket(
            <MessageItem
                message={{
                    id: 'assistant-results',
                    role: 'assistant',
                    text: 'Here are some laptops.',
                    uiSurface: 'product_results',
                    products: [product],
                }}
                {...noopProps}
            />
        );

        expect(screen.getByText('Aura Focus Laptop')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /view details/i })).toBeInTheDocument();
    });

    it('does not render stale product cards for navigation messages', () => {
        renderWithMarket(
            <MessageItem
                message={{
                    id: 'assistant-navigation',
                    role: 'assistant',
                    text: 'Opening Marketplace.',
                    uiSurface: 'navigation_notice',
                    products: [product],
                }}
                {...noopProps}
            />
        );

        expect(screen.queryByRole('button', { name: /select/i })).not.toBeInTheDocument();
        expect(screen.queryByText('Aura Focus Laptop')).not.toBeInTheDocument();
        expect(screen.getByText('Opening Marketplace.')).toBeInTheDocument();
    });

    it('shows an approximate match signal when search fallback was used', () => {
        renderWithMarket(
            <MessageItem
                message={{
                    id: 'assistant-approximate',
                    role: 'assistant',
                    text: 'No exact match. Showing closest results.',
                    uiSurface: 'product_results',
                    products: [product],
                    assistantTurn: {
                        ui: {
                            search: {
                                query: 'oppo',
                                matchType: 'approximate',
                                confidence: 0.58,
                            },
                        },
                    },
                }}
                {...noopProps}
            />
        );

        expect(screen.getByText(/No exact match for "oppo"/i)).toBeInTheDocument();
        expect(screen.getByText(/58% confidence/i)).toBeInTheDocument();
    });

    it('renders verification metadata, sources, and tool runs for grounded answers', () => {
        renderWithMarket(
            <MessageItem
                message={{
                    id: 'assistant-grounded',
                    role: 'assistant',
                    text: 'Checkout is controlled by the AI route and the controller state machine.',
                    uiSurface: 'plain_answer',
                    grounding: {
                        bundleVersion: 'abc123',
                        traceId: 'trace_1',
                    },
                    providerInfo: {
                        name: 'central-intelligence',
                        model: 'google/gemma-4-31B-it',
                    },
                    assistantTurn: {
                        verification: {
                            label: 'app_grounded',
                            summary: 'Verified against indexed app files.',
                        },
                        citations: [
                            {
                                id: 'c1',
                                label: 'app/src/components/features/chat/useAssistantController.js:1',
                                path: 'app/src/components/features/chat/useAssistantController.js',
                            },
                        ],
                        toolRuns: [
                            {
                                id: 't1',
                                toolName: 'search_code_chunks',
                                latencyMs: 42,
                                summary: 'Found 3 code evidence matches.',
                            },
                        ],
                    },
                }}
                {...noopProps}
            />
        );

        expect(screen.getByText('App-grounded')).toBeInTheDocument();
        expect(screen.getByText('Verified against indexed app files.')).toBeInTheDocument();
        expect(screen.getByText(/useAssistantController\.js:1/i)).toBeInTheDocument();
        expect(screen.getByText('search_code_chunks')).toBeInTheDocument();
        expect(screen.getByText('Trace details')).toBeInTheDocument();
    });

    it('renders markdown and fast/refined status signals without duplicating the bubble', () => {
        renderWithMarket(
            <MessageItem
                message={{
                    id: 'assistant-fast',
                    role: 'assistant',
                    text: 'Here is **bold** text.\n\n```js\nconsole.log("hi");\n```',
                    uiSurface: 'plain_answer',
                    provisional: true,
                    upgraded: false,
                }}
                {...noopProps}
            />
        );

        expect(screen.getByText('Fast')).toBeInTheDocument();
        expect(screen.getByText('bold')).toBeInTheDocument();
        expect(screen.getByText('console.log("hi");')).toBeInTheDocument();
    });
});
