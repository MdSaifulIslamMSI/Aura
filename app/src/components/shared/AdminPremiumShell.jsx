import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
    CreditCard,
    LayoutDashboard,
    Package,
    ReceiptText,
    ShoppingBag,
    Users,
} from 'lucide-react';
import { useColorMode } from '@/context/ColorModeContext';
import { FIGMA_COLOR_MODE_OPTIONS } from '@/config/figmaTokens';
import { cn } from '@/lib/utils';

const ADMIN_LINKS = [
    { href: '/admin/dashboard', prefix: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/admin/products', prefix: '/admin/product', label: 'Products', icon: Package },
    { href: '/admin/orders', prefix: '/admin/orders', label: 'Orders', icon: ShoppingBag },
    { href: '/admin/payments', prefix: '/admin/payments', label: 'Payments', icon: CreditCard },
    { href: '/admin/refunds', prefix: '/admin/refunds', label: 'Refunds', icon: ReceiptText },
    { href: '/admin/users', prefix: '/admin/users', label: 'Users', icon: Users },
    { href: '/admin/support', prefix: '/admin/support', label: 'Support', icon: MessageSquare },
];

const hexToRgb = (hex) => {
    const normalized = String(hex || '').trim().replace('#', '');
    if (!normalized) return { r: 34, g: 211, b: 238 };

    const safeHex = normalized.length === 3
        ? normalized.split('').map((value) => `${value}${value}`).join('')
        : normalized.padEnd(6, '0').slice(0, 6);

    const value = Number.parseInt(safeHex, 16);
    if (!Number.isFinite(value)) return { r: 34, g: 211, b: 238 };

    return {
        r: (value >> 16) & 255,
        g: (value >> 8) & 255,
        b: value & 255,
    };
};

const toRgba = (hex, alpha) => {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export function AdminPremiumPanel({ className, children, ...props }) {
    return (
        <section className={cn('admin-premium-panel', className)} {...props}>
            <div className="relative z-[1]">{children}</div>
        </section>
    );
}

export function AdminPremiumSubpanel({ className, children, ...props }) {
    return (
        <div className={cn('admin-premium-subpanel', className)} {...props}>
            {children}
        </div>
    );
}

export function AdminHeroStat({ label, value, detail, icon, className }) {
    return (
        <div className={cn('admin-premium-kpi', className)}>
            <div className="flex items-center justify-between gap-3">
                <p className="premium-kicker">{label}</p>
                <div className="text-[rgb(var(--theme-primary-rgb))]">{icon}</div>
            </div>
            <p className="admin-premium-text-strong mt-3 text-3xl font-black tracking-tight">{value}</p>
            {detail ? <p className="admin-premium-text-muted mt-2 text-sm">{detail}</p> : null}
        </div>
    );
}

export default function AdminPremiumShell({
    eyebrow = 'Aura admin',
    title,
    description,
    actions = null,
    stats = null,
    children,
}) {
    const location = useLocation();
    const { colorMode } = useColorMode();

    const activeMode = useMemo(
        () => FIGMA_COLOR_MODE_OPTIONS.find((option) => option.id === colorMode) || FIGMA_COLOR_MODE_OPTIONS[0],
        [colorMode]
    );
    const isWhiteMode = activeMode.id === 'white';
    const primary = activeMode.preview?.[0] || '#22d3ee';
    const secondary = activeMode.preview?.[1] || '#f97316';

    const backdropStyle = useMemo(() => ({
        background: [
            `radial-gradient(circle at top left, ${toRgba(primary, isWhiteMode ? 0.16 : 0.18)}, transparent 34%)`,
            `radial-gradient(circle at top right, ${toRgba(secondary, isWhiteMode ? 0.12 : 0.16)}, transparent 26%)`,
            `linear-gradient(180deg, ${isWhiteMode ? 'rgba(248, 250, 252, 0.98)' : 'rgba(3, 7, 18, 0.92)'}, transparent 60%)`,
        ].join(','),
    }), [isWhiteMode, primary, secondary]);

    return (
        <div className="premium-page-shell pb-14">
            <div className="pointer-events-none absolute inset-0 -z-10" style={backdropStyle} />

            <div className="premium-page-frame space-y-6 py-6 md:py-8">
                <section className="premium-hero-panel premium-grid-backdrop overflow-hidden px-5 py-6 md:px-8 md:py-8">
                    <div
                        className="pointer-events-none absolute inset-y-0 right-[-10%] hidden w-[38rem] blur-3xl lg:block"
                        style={{ background: `radial-gradient(circle, ${toRgba(secondary, isWhiteMode ? 0.16 : 0.18)}, transparent 62%)` }}
                    />

                    <div className="relative z-[1] flex flex-col gap-6">
                        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                            <div className="max-w-3xl space-y-4">
                                <span className="premium-eyebrow">{eyebrow}</span>
                                <div className="space-y-3">
                                    <h1 className={cn('text-3xl font-black tracking-tight md:text-5xl', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                                        {title}
                                    </h1>
                                    <p className={cn('max-w-2xl text-sm leading-7 md:text-base', isWhiteMode ? 'text-slate-600' : 'text-slate-300')}>
                                        {description}
                                    </p>
                                </div>
                            </div>

                            {actions ? (
                                <div className="flex flex-wrap gap-3 xl:max-w-[34rem] xl:justify-end">
                                    {actions}
                                </div>
                            ) : null}
                        </div>

                        <div className="flex flex-wrap gap-2.5">
                            {ADMIN_LINKS.map((item) => {
                                const Icon = item.icon;
                                const isActive = location.pathname === item.href || location.pathname.startsWith(item.prefix);

                                return (
                                    <Link
                                        key={item.href}
                                        to={item.href}
                                        className={cn('admin-premium-nav-pill', isActive && 'admin-premium-nav-pill-active')}
                                    >
                                        <Icon className="h-4 w-4" />
                                        {item.label}
                                    </Link>
                                );
                            })}
                        </div>

                        {stats ? (
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                {stats}
                            </div>
                        ) : null}
                    </div>
                </section>

                {children}
            </div>
        </div>
    );
}
