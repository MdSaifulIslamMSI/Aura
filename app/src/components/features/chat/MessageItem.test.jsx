import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarketProvider } from '@/context/MarketContext';
import { LocaleProvider } from '@/i18n/LocaleProvider';
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
        <LocaleProvider>
            {ui}
        </LocaleProvider>
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

    it('labels the cart value as an item subtotal and hides zero-value savings', () => {
        renderWithMarket(
            <MessageItem
                message={{
                    id: 'assistant-cart-no-savings',
                    role: 'assistant',
                    text: 'Your cart has two items.',
                    uiSurface: 'cart_summary',
                    cartSummary: {
                        totalItems: 2,
                        totalPrice: 49998,
                        totalDiscount: 0,
                        currency: 'INR',
                    },
                }}
                {...noopProps}
            />
        );

        expect(screen.getByText('Item subtotal')).toBeInTheDocument();
        expect(screen.queryByText('Total')).not.toBeInTheDocument();
        expect(screen.queryByText('Item savings')).not.toBeInTheDocument();
        expect(screen.getByText('Shipping, tax, stock, and final discounts are verified at checkout.')).toBeInTheDocument();
    });

    it('shows real cart savings when the discount is positive', () => {
        renderWithMarket(
            <MessageItem
                message={{
                    id: 'assistant-cart-with-savings',
                    role: 'assistant',
                    text: 'Your cart includes a current item discount.',
                    uiSurface: 'cart_summary',
                    cartSummary: {
                        totalItems: 1,
                        totalPrice: 49999,
                        totalDiscount: 2000,
                        currency: 'INR',
                    },
                }}
                {...noopProps}
            />
        );

        const savedLabel = screen.getByText('Item savings');
        expect(savedLabel).toBeInTheDocument();
        expect(savedLabel.nextElementSibling).toHaveTextContent(/2,000/);
    });

    it('keeps the trust summary visible and collapses technical answer details', () => {
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

        expect(screen.getByText('App-grounded')).toBeVisible();
        expect(screen.getByText('Verified against indexed app files.')).toBeVisible();

        const disclosureSummary = screen.getByText('Why this answer');
        const disclosure = disclosureSummary.closest('details');
        expect(disclosureSummary.tagName).toBe('SUMMARY');
        expect(disclosure).not.toHaveAttribute('open');
        expect(within(disclosure).getByText(/useAssistantController\.js:1/i)).toBeInTheDocument();
        expect(within(disclosure).getByText('search_code_chunks')).not.toBeVisible();
        expect(within(disclosure).getByText(/Trace id:\s*trace_1/)).toBeInTheDocument();
        expect(screen.queryByText('Trace details')).not.toBeInTheDocument();
    });

    it('fails closed for an unknown verification label', () => {
        renderWithMarket(
            <MessageItem
                message={{
                    id: 'assistant-unknown-verification',
                    role: 'assistant',
                    text: 'This claim has an unrecognized verification state.',
                    assistantTurn: {
                        verification: {
                            label: 'unexpected_label',
                        },
                    },
                }}
                {...noopProps}
            />
        );

        expect(screen.getByText('Cannot verify')).toBeInTheDocument();
        expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    });

    it('treats omitted capability metadata as unknown instead of gated', () => {
        renderWithMarket(
            <MessageItem
                message={{
                    id: 'assistant-unknown-text-capability',
                    role: 'assistant',
                    text: 'Provider capability metadata is incomplete.',
                    providerCapabilities: {
                        imageInput: true,
                    },
                }}
                {...noopProps}
            />
        );

        expect(screen.getByText('Text unknown')).toBeInTheDocument();
        expect(screen.getByText('Audio unknown')).toBeInTheDocument();
        expect(screen.queryByText('Text gated')).not.toBeInTheDocument();
        expect(screen.queryByText('Text ready')).not.toBeInTheDocument();
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

    it('renders user media previews and capability metadata for multimodal turns', () => {
        renderWithMarket(
            <MessageItem
                message={{
                    id: 'assistant-multimodal',
                    role: 'assistant',
                    text: 'Image search is ready, but direct audio reasoning is still gated.',
                    uiSurface: 'plain_answer',
                    providerCapabilities: {
                        textInput: true,
                        imageInput: true,
                        audioInput: false,
                    },
                    grounding: {
                        route: 'ECOMMERCE_SEARCH',
                        retrievalHitCount: 3,
                    },
                    providerInfo: {
                        name: 'gemini',
                        model: 'models/gemma-4-31b-it',
                    },
                }}
                {...noopProps}
            />
        );

        expect(screen.getByText('Image ready')).toBeInTheDocument();
        expect(screen.getByText('Audio gated')).toBeInTheDocument();
        expect(screen.getByText(/gemini/i)).toBeInTheDocument();

        renderWithMarket(
            <MessageItem
                message={{
                    id: 'user-media',
                    role: 'user',
                    text: 'Find this exact match.',
                    images: [
                        {
                            fileName: 'sample.jpg',
                            dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlTH0kAAAAASUVORK5CYII=',
                        },
                    ],
                    audio: [
                        {
                            fileName: 'note.webm',
                            mimeType: 'audio/webm',
                        },
                    ],
                }}
                {...noopProps}
            />
        );

        expect(screen.getByAltText('sample.jpg')).toBeInTheDocument();
        expect(screen.getByText('note.webm')).toBeInTheDocument();
    });
});
