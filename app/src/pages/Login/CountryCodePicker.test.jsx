import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n/useStableIcuMessages', () => ({
  useStableIcuMessages: (t) => (typeof t === 'function' ? t : (_id, _values, fallback = '') => fallback),
}));

import CountryCodePicker from './CountryCodePicker';

const options = [
  { countryCode: 'IN', dialCode: '+91', name: 'India' },
  { countryCode: 'US', dialCode: '+1', name: 'United States' },
  { countryCode: 'GB', dialCode: '+44', name: 'United Kingdom' },
];
const selected = { countryCode: 'IN', dialCode: '+91', name: 'India' };

const renderPicker = (props = {}) => render(
  <CountryCodePicker options={options} selectedCountry={selected} onSelect={vi.fn()} t={(_k, _v, fallback) => fallback} {...props} />
);

const openPanel = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Change country code: {country} {dialCode}' }));
};

describe('CountryCodePicker', () => {
  it('shows the selected country dial code on the trigger', () => {
    renderPicker();
    expect(screen.getByText('+91')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change country code: {country} {dialCode}' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the panel and lists all options with counts', () => {
    renderPicker();
    openPanel();
    expect(screen.getByRole('dialog', { name: 'Choose country code' })).toBeInTheDocument();
    expect(screen.getByText('3 countries available')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /India/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('filters options by name, code or dial code', () => {
    renderPicker();
    openPanel();
    const search = screen.getByRole('searchbox', { name: 'Search countries or dial codes' });
    fireEvent.change(search, { target: { value: 'united' } });
    expect(screen.getByText('2 countries available')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /India/ })).toBeNull();
    fireEvent.change(search, { target: { value: '+44' } });
    expect(screen.getByText('1 countries available')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /United Kingdom/ })).toBeInTheDocument();
  });

  it('selects an option and notifies the parent with the code', () => {
    const onSelect = vi.fn();
    renderPicker({ onSelect });
    openPanel();
    fireEvent.click(screen.getByRole('option', { name: /United States/ }));
    expect(onSelect).toHaveBeenCalledWith('US');
  });

  it('disables the trigger when disabled', () => {
    renderPicker({ disabled: true });
    expect(screen.getByRole('button', { name: 'Change country code: {country} {dialCode}' })).toBeDisabled();
  });

  it('closes the panel via the close control', () => {
    renderPicker();
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Close country code picker' }));
    expect(screen.queryByRole('dialog', { name: 'Choose country code' })).toBeNull();
  });
});
