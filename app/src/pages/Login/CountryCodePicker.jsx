import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';

const CountryCodePicker = ({
  disabled = false,
  onSelect,
  options = [],
  selectedCountry,
  t: legacyT,
}) => {
  const t = useStableIcuMessages(legacyT);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const panelRef = useRef(null);
  const panelId = useId();

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return options;

    return options.filter((option) => (
      option.name.toLocaleLowerCase().includes(normalizedQuery)
      || option.countryCode.toLocaleLowerCase().includes(normalizedQuery)
      || option.dialCode.includes(normalizedQuery)
    ));
  }, [options, query]);

  const closePanel = useCallback(({ restoreFocus = true } = {}) => {
    setIsOpen(false);
    setQuery('');
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = requestAnimationFrame(() => searchRef.current?.focus());
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) {
        closePanel({ restoreFocus: false });
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel();
      } else if (event.key === 'Tab') {
        const focusable = panelRef.current?.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closePanel, isOpen]);

  const focusOption = (index) => {
    const renderedOptions = panelRef.current?.querySelectorAll('[role="option"]');
    if (!renderedOptions?.length) return;
    const safeIndex = Math.max(0, Math.min(index, renderedOptions.length - 1));
    renderedOptions[safeIndex]?.focus();
  };

  const handleOptionKeyDown = (event, index) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (index === 0) searchRef.current?.focus();
      else focusOption(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOption(filteredOptions.length - 1);
    }
  };

  const selectCountry = (option) => {
    onSelect(option.countryCode);
    closePanel();
  };

  return (
    <div className="login-country-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="login-country-picker__trigger"
        onClick={() => setIsOpen((current) => !current)}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-controls={panelId}
        aria-label={t(
          'login.country.changeAriaLabel',
          {
            country: selectedCountry?.name || '',
            dialCode: selectedCountry?.dialCode || '',
          },
          'Change country code: {country} {dialCode}'
        )}
      >
        <span className="login-country-picker__flag" aria-hidden="true">
          {selectedCountry?.flag || selectedCountry?.countryCode}
        </span>
        <span className="login-country-picker__selection">
          <span>{t('login.country.controlLabel', {}, 'Country code')}</span>
          <strong>{selectedCountry?.name || selectedCountry?.countryCode}</strong>
        </span>
        <span className="login-country-picker__dial">{selectedCountry?.dialCode}</span>
        <ChevronDown className={isOpen ? 'login-country-picker__chevron login-country-picker__chevron--open' : 'login-country-picker__chevron'} aria-hidden="true" />
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <>
          <div className="login-country-picker__backdrop" aria-hidden="true" onPointerDown={() => closePanel()} />
          <div ref={panelRef} id={panelId} className="login-country-picker__panel" role="dialog" aria-modal="true" aria-label={t('login.country.panelLabel', {}, 'Choose country code')}>
            <div className="login-country-picker__panel-header">
              <div>
                <p>{t('login.country.panelEyebrow', {}, 'Phone verification')}</p>
                <h2>{t('login.country.panelTitle', {}, 'Choose country code')}</h2>
              </div>
              <button type="button" className="login-country-picker__close" onClick={() => closePanel()} aria-label={t('login.country.close', {}, 'Close country code picker')}>
                <X aria-hidden="true" />
              </button>
            </div>

            <label className="login-country-picker__search">
              <span className="sr-only">{t('login.country.searchLabel', {}, 'Search countries or dial codes')}</span>
              <Search aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' && filteredOptions.length) {
                    event.preventDefault();
                    focusOption(0);
                  }
                }}
                placeholder={t('login.country.searchPlaceholder', {}, 'Search country, code, or +91')}
                autoComplete="off"
              />
            </label>

            <p className="login-country-picker__count" role="status" aria-live="polite">
              {filteredOptions.length} {t('login.country.results', {}, 'countries available')}
            </p>

            {filteredOptions.length ? (
              <div className="login-country-picker__options" role="listbox" aria-label={t('login.country.resultsLabel', {}, 'Country code results')}>
                {filteredOptions.map((option, index) => {
                  const isSelected = option.countryCode === selectedCountry?.countryCode;
                  return (
                    <button
                      key={option.countryCode}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={isSelected ? 'login-country-picker__option login-country-picker__option--selected' : 'login-country-picker__option'}
                      onClick={() => selectCountry(option)}
                      onKeyDown={(event) => handleOptionKeyDown(event, index)}
                    >
                      <span className="login-country-picker__option-flag" aria-hidden="true">{option.flag}</span>
                      <span className="login-country-picker__option-name">
                        <strong>{option.name}</strong>
                        <span>{option.countryCode}</span>
                      </span>
                      <span className="login-country-picker__option-dial">{option.dialCode}</span>
                      {isSelected && <Check aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="login-country-picker__empty">
                {t('login.country.noResults', {}, 'No country codes match that search.')}
              </p>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
};

export default CountryCodePicker;
