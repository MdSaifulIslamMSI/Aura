import React, { Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { lazyWithRetry } from './lazyWithRetry';

const el = React.createElement;

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    render() {
        if (this.state.error) {
            return el('div', { 'data-testid': 'boundary-fallback' }, `failed to load: ${this.state.error.message}`);
        }
        return this.props.children;
    }
}

const mountLazy = (Lazy) => render(
    el(Suspense, { fallback: el('div', null, 'loading') },
        el(ErrorBoundary, null, el(Lazy)),
    ),
);

const retryKeyFor = (key) => `aura-lazy-retry:${key}:${window.location.pathname}${window.location.search}`;

describe('lazyWithRetry', () => {
    it('returns a lazy React component', () => {
        const Lazy = lazyWithRetry(() => Promise.resolve({ default: () => null }), 'shape');
        expect(Lazy.$$typeof).toBe(Symbol.for('react.lazy'));
        expect(typeof Lazy._init).toBe('function');
    });

    it('renders the module default export and clears any retry marker on success', async () => {
        const factory = vi.fn(() => Promise.resolve({ default: () => el('div', null, 'chunk-loaded') }));
        const Lazy = lazyWithRetry(factory, 'success-key', 500);

        mountLazy(Lazy);
        expect(await screen.findByText('chunk-loaded')).toBeTruthy();
        expect(factory).toHaveBeenCalledTimes(1);
        expect(sessionStorage.getItem(retryKeyFor('success-key'))).toBeNull();
    });

    it('rethrows chunk load failures after a retry reload was already attempted', async () => {
        const key = 'chunk-key';
        sessionStorage.setItem(retryKeyFor(key), '1');
        const factory = () => Promise.reject(new Error('Failed to fetch dynamically imported module: /x.js'));
        const Lazy = lazyWithRetry(factory, key, 500);

        mountLazy(Lazy);
        const fallback = await screen.findByTestId('boundary-fallback');
        expect(fallback.textContent).toContain('Failed to fetch dynamically imported module');
        expect(sessionStorage.getItem(retryKeyFor(key))).toBeNull();
    });

    it('surfaces the timeout error for imports that never settle', async () => {
        const key = 'slow-key';
        sessionStorage.setItem(retryKeyFor(key), '1');
        const Lazy = lazyWithRetry(() => new Promise(() => {}), key, 25);

        mountLazy(Lazy);
        const fallback = await screen.findByTestId('boundary-fallback');
        await waitFor(() => {
            expect(fallback.textContent).toContain('Lazy route import timed out: slow-key');
        });
    });

    it('propagates non-chunk errors untouched without touching sessionStorage', async () => {
        const Lazy = lazyWithRetry(() => Promise.reject(new Error('boom')), 'regular-key', 500);

        mountLazy(Lazy);
        const fallback = await screen.findByTestId('boundary-fallback');
        expect(fallback.textContent).toContain('failed to load: boom');
        expect(sessionStorage.getItem(retryKeyFor('regular-key'))).toBeNull();
    });
});
