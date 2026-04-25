import { useContext, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Search, ShoppingCart, Store, User } from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';
import { CartContext } from '@/context/CartContext';
import { cn } from '@/lib/utils';
import { isCapacitorNativeRuntime } from '@/utils/nativeRuntime';

const shouldHideTabBar = (pathname = '/') => {
  const path = String(pathname || '/');
  return (
    path === '/login'
    || path.startsWith('/admin')
    || path.startsWith('/assistant')
    || path.startsWith('/checkout')
    || path.startsWith('/product/')
    || path.startsWith('/launch')
  );
};

const matchesPath = (pathname, paths = []) => paths.some((path) => {
  if (path.endsWith('*')) {
    return pathname.startsWith(path.slice(0, -1));
  }
  return pathname === path;
});

const MobileNativeTabBar = () => {
  const location = useLocation();
  const { currentUser } = useContext(AuthContext) || {};
  const { cartItems = [] } = useContext(CartContext) || {};
  const pathname = location.pathname || '/';
  const cartItemCount = cartItems.reduce((sum, item) => sum + Number(item?.quantity || 0), 0);

  const tabs = useMemo(() => [
    {
      label: 'Home',
      to: '/',
      icon: Home,
      active: pathname === '/',
    },
    {
      label: 'Search',
      to: '/search',
      icon: Search,
      active: matchesPath(pathname, ['/search', '/products', '/category/*', '/deals', '/trending', '/new-arrivals']),
    },
    {
      label: 'Market',
      to: '/marketplace',
      icon: Store,
      active: matchesPath(pathname, ['/marketplace', '/listing/*', '/seller/*']),
    },
    {
      label: 'Cart',
      to: '/cart',
      icon: ShoppingCart,
      active: pathname === '/cart',
      badge: cartItemCount,
    },
    {
      label: currentUser ? 'Account' : 'Login',
      to: currentUser ? '/profile' : '/login',
      icon: User,
      active: matchesPath(pathname, ['/profile', '/orders', '/wishlist', '/my-listings', '/become-seller', '/sell']),
    },
  ], [cartItemCount, currentUser, pathname]);

  if (!isCapacitorNativeRuntime() || shouldHideTabBar(pathname)) {
    return null;
  }

  return (
    <nav className="aura-mobile-tabbar md:hidden" aria-label="Primary mobile app navigation">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const badge = Number(tab.badge || 0);

        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={cn('aura-mobile-tabbar-item', tab.active && 'aura-mobile-tabbar-item-active')}
            aria-current={tab.active ? 'page' : undefined}
          >
            <span className="aura-mobile-tabbar-icon">
              <Icon className="h-[1.15rem] w-[1.15rem]" />
              {badge > 0 ? (
                <span className="aura-mobile-tabbar-badge">
                  {badge > 9 ? '9+' : badge}
                </span>
              ) : null}
            </span>
            <span className="aura-mobile-tabbar-label">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};

export default MobileNativeTabBar;
