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
        expect(screen.getByRole('main', { name: 'Overview' })).toBeInTheDocument();
        expect(screen.getByText('75% complete')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Change profile photo' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Orders' }));
        expect(onTabChange).toHaveBeenCalledWith('orders');

        fireEvent.change(screen.getByLabelText('Account section', { selector: 'select' }), {
            target: { value: 'orders' },
        });
        expect(onTabChange).toHaveBeenLastCalledWith('orders');
    });
});
