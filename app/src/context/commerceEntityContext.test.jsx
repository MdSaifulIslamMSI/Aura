import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContext } from 'react';
import { renderHook } from '@testing-library/react';

vi.mock('../store/commerceStore', () => ({ useCommerceStore: vi.fn() }));

import { useCommerceStore } from '../store/commerceStore';
import {
    createCommerceEntityContext,
    useDeferredStoreAction,
    useRefreshFromServer,
} from './commerceEntityContext';

let storeState;

beforeEach(() => {
    storeState = { items: [], loading: false };
    useCommerceStore.mockImplementation((selector) => selector(storeState));
});

describe('createCommerceEntityContext', () => {
    const { Context, Provider } = createCommerceEntityContext({
        displayName: 'TestEntity',
        selectItems: (state) => state.items,
        selectLoading: (state) => state.loading,
        useContextValue: ({ items, isLoading }) => ({
            count: items.length,
            isLoading,
        }),
    });

    const useTestEntity = () => useContext(Context);
    const wrapper = ({ children }) => <Provider>{children}</Provider>;

    it('names the context and its provider after the entity', () => {
        expect(Context.displayName).toBe('TestEntity');
        expect(Provider.displayName).toBe('TestEntityProvider');
    });

    it('projects store state through the entity selectors', () => {
        storeState = { items: [{ id: 1 }, { id: 2 }], loading: true };

        const { result } = renderHook(useTestEntity, { wrapper });
        expect(result.current).toEqual({ count: 2, isLoading: true });
    });

    it('refreshes the context value when the store changes', () => {
        const { result, rerender } = renderHook(useTestEntity, { wrapper });
        expect(result.current).toEqual({ count: 0, isLoading: false });

        storeState = { items: [{ id: 9 }], loading: true };
        rerender();

        expect(result.current).toEqual({ count: 1, isLoading: true });
    });
});

describe('useDeferredStoreAction', () => {
    it('keeps a stable callback identity while the action is unchanged', () => {
        const action = vi.fn();
        const { result, rerender } = renderHook(
            (nextAction) => useDeferredStoreAction(nextAction),
            { initialProps: action }
        );
        const first = result.current;
        rerender(action);
        expect(result.current).toBe(first);
    });

    it('recreates the callback when the action changes', () => {
        const { result, rerender } = renderHook(
            (nextAction) => useDeferredStoreAction(nextAction),
            { initialProps: vi.fn() }
        );
        const first = result.current;
        const nextAction = vi.fn();
        rerender(nextAction);
        expect(result.current).not.toBe(first);
    });

    it('forwards every argument to the action', () => {
        const action = vi.fn();
        const { result } = renderHook(() => useDeferredStoreAction(action));

        result.current('a', 2, { three: 3 });
        expect(action).toHaveBeenCalledWith('a', 2, { three: 3 });
    });
});

describe('useRefreshFromServer', () => {
    const setup = () => {
        const hydrate = vi.fn();
        const refreshIfStale = vi.fn();
        const { result } = renderHook(() => useRefreshFromServer(hydrate, refreshIfStale));
        return { hydrate, refreshIfStale, refresh: result.current };
    };

    it('delegates to refreshIfStale for non-forced refreshes only', () => {
        const { hydrate, refreshIfStale, refresh } = setup();

        refresh();
        expect(refreshIfStale).toHaveBeenCalledWith({ force: false });
        expect(hydrate).not.toHaveBeenCalled();
    });

    it('routes forced refreshes to hydrate and normalizes mergeGuest to a boolean', () => {
        const { hydrate, refreshIfStale, refresh } = setup();

        refresh({ force: true });
        expect(hydrate).toHaveBeenCalledWith({ force: true, mergeGuest: false });
        expect(refreshIfStale).not.toHaveBeenCalled();

        refresh({ force: true, mergeGuest: true });
        expect(hydrate).toHaveBeenCalledWith({ force: true, mergeGuest: true });
    });
});
