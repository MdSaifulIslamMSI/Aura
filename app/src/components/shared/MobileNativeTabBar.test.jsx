import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/context/AuthContext';
import { CartContext } from '@/context/CartContext';

const mocks = vi.hoisted(() => ({
  isCapacitorNativeRuntime: vi.fn(),
}));

vi.mock('@/utils/nativeRuntime', () => ({
  isCapacitorNativeRuntime: mocks.isCapacitorNativeRuntime,
}));

import MobileNativeTabBar from './MobileNativeTabBar';

const renderTabBar = ({
  cartItems = [],
  currentUser = null,
  initialEntry = '/',
} = {}) => render(
  <MemoryRouter initialEntries={[initialEntry]}>
    <AuthContext.Provider value={{ currentUser }}>
      <CartContext.Provider value={{ cartItems }}>
        <MobileNativeTabBar />
      </CartContext.Provider>
    </AuthContext.Provider>
  </MemoryRouter>
);

describe('MobileNativeTabBar', () => {
  beforeEach(() => {
    mocks.isCapacitorNativeRuntime.mockReturnValue(true);
  });

  it('renders the native app tabs with account state and capped cart badge', () => {
    renderTabBar({
      cartItems: [{ quantity: 7 }, { quantity: 4 }],
      currentUser: { uid: 'user-1' },
      initialEntry: '/cart',
    });

    expect(screen.getByRole('navigation', { name: /primary mobile app navigation/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /account/i })).toHaveAttribute('href', '/profile');
    expect(screen.getByText('9+')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /cart/i })).toHaveAttribute('aria-current', 'page');
  });

  it('uses the login destination for signed-out users', () => {
    renderTabBar();

    expect(screen.getByRole('link', { name: /login/i })).toHaveAttribute('href', '/login');
  });

  it('does not render outside the native runtime', () => {
    mocks.isCapacitorNativeRuntime.mockReturnValue(false);

    renderTabBar();

    expect(screen.queryByRole('navigation', { name: /primary mobile app navigation/i })).not.toBeInTheDocument();
  });

  it('stays hidden on immersive or protected flow routes', () => {
    renderTabBar({ initialEntry: '/checkout' });

    expect(screen.queryByRole('navigation', { name: /primary mobile app navigation/i })).not.toBeInTheDocument();
  });
});
