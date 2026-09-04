import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AccountCenterShell from './AccountCenterShell';

const TestIcon = (props) => <svg {...props} />;

const tabs = [
    { id: 'overview', label: 'Overview', icon: TestIcon },
    { id: 'orders', label: 'Orders', icon: TestIcon },
];

describe('AccountCenterShell', () => {
    it('exposes current navigation, a mobile section control, and the active page heading', () => {
        const onTabChange = vi.fn();

        render(
            <AccountCenterShell
                tabs={tabs}
                activeTab="overview"
                onTabChange={onTabChange}
                profile={{
                    name: 'Profile User',
                    email: 'profile@example.com',
                    initials: 'PU',
                }}
                pageTitle="Overview"
                pageDescription="Review the account details that need your attention."
                memberSince="July 2026"
                profileCompletion={75}
                accountState="active"
                accountStateLabel="active"
                overviewMetrics={[
                    { label: 'Orders', value: '2', detail: 'Placed from this account' },
                ]}
                onAvatarClick={vi.fn()}
            >
                <p>Account content</p>
            </AccountCenterShell>,
        );

        expect(screen.getByRole('navigation', { name: 'Account sections' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Skip to account content' })).toHaveAttribute('href', '#account-center-content');
        expect(screen.getByRole('main', { name: 'Overview' })).toHaveAttribute('tabindex', '-1');
        expect(screen.getByText('75% complete')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Change profile photo' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Orders' }));
        expect(onTabChange).toHaveBeenCalledWith('orders');

        fireEvent.change(screen.getByLabelText('Account section', { selector: 'select' }), {
            target: { value: 'orders' },
        });
        expect(onTabChange).toHaveBeenLastCalledWith('orders');
    });

    it('moves focus to the page heading when the active tab changes', () => {
        const { rerender } = render(
            <AccountCenterShell
                tabs={tabs}
                activeTab="overview"
                onTabChange={vi.fn()}
                profile={{
                    name: 'Profile User',
                    email: 'profile@example.com',
                    initials: 'PU',
                }}
                pageTitle="Overview"
                pageDescription="Account overview"
                memberSince="July 2026"
                profileCompletion={75}
                accountState="active"
                accountStateLabel="active"
                onAvatarClick={vi.fn()}
            >
                <p>Account content</p>
            </AccountCenterShell>,
        );

        rerender(
            <AccountCenterShell
                tabs={tabs}
                activeTab="orders"
                onTabChange={vi.fn()}
                profile={{
                    name: 'Profile User',
                    email: 'profile@example.com',
                    initials: 'PU',
                }}
                pageTitle="Orders"
                pageDescription="Order history"
                memberSince="July 2026"
                profileCompletion={75}
                accountState="active"
                accountStateLabel="active"
                onAvatarClick={vi.fn()}
            >
                <p>Account content</p>
            </AccountCenterShell>,
        );

        expect(screen.getByRole('heading', { name: 'Orders', level: 1 })).toHaveFocus();
    });

    it('disables avatar replacement and exposes progress while an upload is active', () => {
        render(
            <AccountCenterShell
                tabs={tabs}
                activeTab="overview"
                onTabChange={vi.fn()}
                profile={{
                    name: 'Profile User',
                    email: 'profile@example.com',
                    initials: 'PU',
                }}
                pageTitle="Overview"
                pageDescription="Account overview"
                memberSince="July 2026"
                profileCompletion={75}
                accountState="active"
                accountStateLabel="active"
                onAvatarClick={vi.fn()}
                avatarUploading
            >
                <p>Account content</p>
            </AccountCenterShell>,
        );

        const button = screen.getByRole('button', { name: 'Profile photo upload in progress' });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('aria-busy', 'true');
    });

    it('announces offline read-only state without hiding account content', () => {
        render(
            <AccountCenterShell
                tabs={tabs}
                activeTab="overview"
                onTabChange={vi.fn()}
                profile={{
                    name: 'Profile User',
                    email: 'profile@example.com',
                    initials: 'PU',
                    avatar: '/uploads/avatars/profile.webp',
                }}
                pageTitle="Overview"
                pageDescription="Account overview"
                memberSince="July 2026"
                profileCompletion={75}
                accountState="active"
                accountStateLabel="active"
                onAvatarClick={vi.fn()}
                isOnline={false}
            >
                <p>Account content remains available</p>
            </AccountCenterShell>,
        );

        expect(screen.getByRole('status')).toHaveTextContent('You are offline.');
        expect(screen.getByText('Account content remains available')).toBeInTheDocument();
        expect(document.querySelector('img[src="/uploads/avatars/profile.webp"]')).toHaveAttribute('width', '52');
    });
});
