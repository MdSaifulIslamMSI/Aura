import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIntl } from 'react-intl';
import { LocaleProvider, useLocale } from './LocaleProvider';
import { criticalMessages } from './messages/criticalMessages';

const { marketState } = vi.hoisted(() => ({
    marketState: {
        direction: 'ltr',
        languageCode: 'hi',
        locale: 'hi-IN',
    },
}));

vi.mock('@/context/MarketContext', () => ({
    useMarket: () => marketState,
}));

function LocaleProbe() {
    const intl = useIntl();
    const locale = useLocale();

    return (
        <div>
            <div data-testid="active-language">{locale.language}</div>
            <div data-testid="item-count">
                {intl.formatMessage(criticalMessages.itemCount, { count: 2 })}
            </div>
        </div>
    );
}

beforeEach(() => {
    marketState.direction = 'ltr';
    marketState.languageCode = 'hi';
    marketState.locale = 'hi-IN';
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('LocaleProvider', () => {
    it('formats reviewed ICU plurals when the FormatJS migration layer is enabled', async () => {
        vi.stubEnv('VITE_I18N_FORMATJS_ENABLED', 'true');

        render(
            <LocaleProvider>
                <LocaleProbe />
            </LocaleProvider>
        );

        expect(screen.getByTestId('active-language')).toHaveTextContent('hi');
        await waitFor(() => {
            expect(screen.getByTestId('item-count')).toHaveTextContent('2 आइटम');
        });
    });

    it('falls back to English while the FormatJS migration layer is disabled', () => {
        vi.stubEnv('VITE_I18N_FORMATJS_ENABLED', 'false');

        render(
            <LocaleProvider>
                <LocaleProbe />
            </LocaleProvider>
        );

        expect(screen.getByTestId('active-language')).toHaveTextContent('en');
        expect(screen.getByTestId('item-count')).toHaveTextContent('2 items');
    });
});
