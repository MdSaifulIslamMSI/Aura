import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/context/AuthContext';

const {
  createVoiceSessionMock,
  useSpeechInputMock,
  useOptionalMarketMock,
  chatState,
} = vi.hoisted(() => {
  const noop = vi.fn();
  return {
    createVoiceSessionMock: vi.fn(),
    useSpeechInputMock: vi.fn(() => ({
      isListening: false,
      supportsSpeechInput: true,
      stopListening: noop,
      toggleListening: noop,
    })),
    useOptionalMarketMock: vi.fn(() => ({
      locale: 'hi',
      voiceLocale: 'hi-IN',
    })),
    chatState: {
      activeSession: { id: 'sess-1', title: 'ऑर्डर सहायता', originPath: '/' },
      activeSessionId: 'sess-1',
      groupedSessions: [
        {
          key: 'recent',
          label: 'हाल की',
          sessions: [
            {
              id: 'sess-1',
              title: 'ऑर्डर सहायता',
              preview: 'मेरा पैकेज कहाँ है?',
              updatedAt: 1700000000000,
              pinned: false,
            },
          ],
        },
      ],
      sessionSearchQuery: '',
      messages: [],
      inputValue: '',
      isLoading: false,
      mode: 'explore',
      status: 'idle',
      context: { route: '/', isAuthenticated: false },
      primaryAction: null,
      secondaryActions: [],
      viewerScope: 'guest',
      sessions: [],
      getSessionConversationRevision: vi.fn(() => 0),
      setInputValue: noop,
      setActiveSession: noop,
      togglePinnedSession: noop,
      setSessionSearchQuery: noop,
      resetConversation: noop,
      replaceSessionsFromServer: noop,
      hydrateSessionFromServer: noop,
      clearActiveSessionConversation: noop,
      switchViewerScope: noop,
    },
  };
});

vi.mock('@/context/MarketContext', () => ({
  useOptionalMarket: () => useOptionalMarketMock(),
}));

vi.mock('@/hooks/useSpeechInput', () => ({
  useSpeechInput: (args) => useSpeechInputMock(args),
}));

vi.mock('@/services/aiApi', () => ({
  aiApi: {
    createVoiceSession: createVoiceSessionMock,
    listSessions: vi.fn(),
    getSession: vi.fn(),
    createSession: vi.fn(),
    resetSession: vi.fn(),
  },
}));

vi.mock('@/components/features/chat/useAssistantController', () => ({
  useAssistantController: () => ({
    inputRef: { current: null },
    addProductToCart: vi.fn(),
    cancelPendingAction: vi.fn(),
    confirmPendingAction: vi.fn(),
    handleAction: vi.fn(),
    handleUserInput: vi.fn(),
    invalidateSessionRequest: vi.fn(),
    modifyPendingAction: vi.fn(),
    openSupport: vi.fn(),
    selectProduct: vi.fn(),
  }),
}));

vi.mock('@/components/features/chat/ActionBar', () => ({
  default: () => <div data-testid="mock-action-bar" />,
}));

vi.mock('@/components/features/chat/MessageList', () => ({
  default: () => <div data-testid="mock-message-list" />,
}));

vi.mock('@/components/features/chat/MultimodalDock', () => ({
  default: () => <div data-testid="mock-multimodal-dock" />,
}));

vi.mock('@/store/chatStore', () => {
  const useChatStore = (selector) => selector(chatState);
  useChatStore.getState = () => chatState;
  return { useChatStore };
});

vi.mock('@/store/commerceStore', () => {
  const commerceState = { cart: { items: [] } };
  return {
    useCommerceStore: (selector) => selector(commerceState),
    selectCartSummary: () => ({ totalItems: 0, totalPrice: 0, currency: 'INR' }),
  };
});

vi.mock('@/i18n/StableText', () => ({
  StableText: ({ defaultMessage }) => <>{defaultMessage}</>,
}));

import AssistantPage from './index';

const renderAssistant = (locale = 'hi', messages = {}) => render(
  <IntlProvider locale={locale} messages={messages} onError={() => {}}>
    <AuthContext.Provider value={{ currentUser: null, dbUser: null, isAuthenticated: false, loading: false }}>
      <MemoryRouter initialEntries={['/assistant']}>
        <AssistantPage />
      </MemoryRouter>
    </AuthContext.Provider>
  </IntlProvider>
);

describe('AssistantPage localization and voice locale plumbing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOptionalMarketMock.mockReturnValue({ locale: 'hi', voiceLocale: 'hi-IN' });
    createVoiceSessionMock.mockResolvedValue({
      realtimeEnabled: true,
      supportsAudioUpload: true,
      capabilities: {
        speechToText: { mode: 'server_ready' },
        textToSpeech: { mode: 'server_ready' },
      },
    });
  });

  it('forwards voiceLocale to useSpeechInput and createVoiceSession, formats session time via intl, and localizes error states', async () => {
    const hiMessages = {
      'assistant.voice.warmupUnavailable': 'वॉइस सतह तैयार हो रही है।',
      'assistant.attachment.unsupportedType': 'केवल छवि और ऑडियो फ़ाइलें समर्थित हैं।',
      'cart.jsx.expression.compare.products.review.a.cart.or.find.40cd3600': 'ऑर्डर, उत्पाद या कार्ट के बारे में पूछें',
      'assistant.fastStarts.eyebrow': 'त्वरित शुरुआत',
    };

    createVoiceSessionMock.mockRejectedValue(new Error('warmup failed'));

    const { container } = renderAssistant('hi', hiMessages);

    expect(useSpeechInputMock).toHaveBeenCalledWith(expect.objectContaining({ lang: 'hi-IN' }));
    await waitFor(() => expect(createVoiceSessionMock).toHaveBeenCalledWith({ locale: 'hi-IN' }));

    expect(await screen.findByText('वॉइस सतह तैयार हो रही है।')).toBeInTheDocument();
    expect(screen.getByText('त्वरित शुरुआत')).toBeInTheDocument();

    const expectedTime = new Intl.DateTimeFormat('hi', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(1700000000000));
    expect(screen.getByText(expectedTime)).toBeInTheDocument();

    const fileInput = container.querySelector('input[type="file"]');
    const badFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [badFile] } });

    expect(await screen.findByText('केवल छवि और ऑडियो फ़ाइलें समर्थित हैं।')).toBeInTheDocument();
  });
});
