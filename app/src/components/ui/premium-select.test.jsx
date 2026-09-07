import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PremiumSelect from './premium-select';

const renderSelect = (props = {}) => render(
  <PremiumSelect onChange={vi.fn()} {...props}>
    <option value="in">India</option>
    <option value="us">United States</option>
    <option value="gb" disabled>United Kingdom</option>
  </PremiumSelect>
);

describe('PremiumSelect', () => {
  it('renders the trigger with the selected label', () => {
    renderSelect({ value: 'us' });
    expect(screen.getByText('United States')).toBeInTheDocument();
  });

  it('falls back to the first option when uncontrolled', () => {
    renderSelect({});
    expect(screen.getByText('India')).toBeInTheDocument();
  });

  it('opens the menu and lists options on trigger click', () => {
    renderSelect({ value: 'in' });
    const trigger = screen.getByText('India').closest('button');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('option', { name: 'United States' })).toBeInTheDocument();
  });

  it('selects options and emits synthetic change events', () => {
    const onChange = vi.fn();
    renderSelect({ value: 'in', onChange, name: 'country' });
    fireEvent.click(screen.getByText('India'));
    fireEvent.click(screen.getByRole('option', { name: 'United States' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({ value: 'us', name: 'country' }),
    }));
  });

  it('marks disabled options as unavailable', () => {
    renderSelect({ value: 'in' });
    fireEvent.click(screen.getByText('India'));
    expect(screen.getByRole('option', { name: 'United Kingdom' })).toBeDisabled();
  });

  it('disables the trigger when disabled', () => {
    renderSelect({ value: 'in', disabled: true });
    expect(screen.getByText('India').closest('button')).toBeDisabled();
  });

  it('closes the menu on Escape via the dismiss layer', () => {
    renderSelect({ value: 'in' });
    fireEvent.click(screen.getAllByText('India')[0]);
    expect(screen.getByRole('option', { name: 'United States' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('option', { name: 'United States' })).toBeNull();
  });
});
