import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IntlProvider } from 'react-intl';
import DesktopUpdateBanner from './DesktopUpdateBanner';

let listener = null;
const bridge = {
  isDesktop: true,
  onUpdateStatus: vi.fn((cb) => {
    listener = cb;
    return () => { listener = null; };
  }),
};

const renderBanner = () => render(
  <IntlProvider locale="en" defaultLocale="en">
    <DesktopUpdateBanner />
  </IntlProvider>
);

describe('DesktopUpdateBanner', () => {
  it('renders nothing outside the desktop shell', () => {
    delete window.auraDesktop;
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before any update status arrives', () => {
    window.auraDesktop = bridge;
    listener = null;
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
    expect(bridge.onUpdateStatus).toHaveBeenCalled();
  });

  it('shows the checking state with a spinner', () => {
    window.auraDesktop = bridge;
    renderBanner();
    act(() => { listener({ type: 'checking' }); });
    expect(screen.getByText('Checking for Aura updates')).toBeInTheDocument();
  });

  it('announces available versions and clamps progress', () => {
    window.auraDesktop = bridge;
    renderBanner();
    act(() => { listener({ type: 'available', version: '2.1.0' }); });
    expect(screen.getByText('Aura 2.1.0 is downloading')).toBeInTheDocument();
    act(() => { listener({ type: 'downloading', percent: 250 }); });
    expect(screen.getByText(/100% complete/)).toBeInTheDocument();
  });

  it('dismisses via Later and resurfaces on new state types', () => {
    window.auraDesktop = bridge;
    renderBanner();
    act(() => { listener({ type: 'downloaded', version: '2.1.0' }); });
    expect(screen.getByText('Aura 2.1.0 is ready')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText('Aura 2.1.0 is ready')).toBeNull();
    act(() => { listener({ type: 'checking' }); });
    expect(screen.getByText('Checking for Aura updates')).toBeInTheDocument();
    delete window.auraDesktop;
    listener = null;
  });

  it('triggers install on restart-and-update', () => {
    const installUpdateNow = vi.fn();
    window.auraDesktop = { ...bridge, installUpdateNow };
    renderBanner();
    act(() => { listener({ type: 'downloaded' }); });
    fireEvent.click(screen.getByRole('button', { name: 'Restart and update' }));
    expect(installUpdateNow).toHaveBeenCalledOnce();
    delete window.auraDesktop;
    listener = null;
  });
});
