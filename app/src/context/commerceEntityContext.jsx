import { createContext, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useCommerceStore } from '../store/commerceStore';

export const useDeferredStoreAction = (action) => useMemo(() => (
  (...args) => {
    void action(...args);
  }
), [action]);

export const useRefreshFromServer = (hydrate, refreshIfStale) => useMemo(() => (
  (options = {}) => (
    options?.force === true
      ? hydrate({ force: true, mergeGuest: options?.mergeGuest === true })
      : refreshIfStale({ force: options?.force === true })
  )
), [hydrate, refreshIfStale]);

export const createCommerceEntityContext = ({
  displayName,
  selectItems,
  selectLoading,
  useContextValue,
}) => {
  const EntityContext = createContext();
  EntityContext.displayName = displayName;

  const EntityProvider = ({ children }) => {
    const items = useCommerceStore(useShallow(selectItems));
    const isLoading = useCommerceStore(selectLoading);
    const value = useContextValue({ items, isLoading });

    return (
      <EntityContext.Provider value={value}>
        {children}
      </EntityContext.Provider>
    );
  };

  EntityProvider.displayName = `${displayName}Provider`;

  return {
    Context: EntityContext,
    Provider: EntityProvider,
  };
};
