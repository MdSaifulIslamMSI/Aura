import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { IntlProvider } from 'react-intl';

vi.mock('@/context/MarketContext', () => ({
  useMarket: () => ({ t: (_key, _opts, fallback) => fallback, voiceLocale: 'en-IN' }),
}));

vi.mock('@/services/aiApi', () => ({
  aiApi: { chat: vi.fn(), createVoiceSession: vi.fn(async () => ({})), speakText: vi.fn() },
}));

vi.mock('@/i18n/useStableIcuMessages', () => ({
  useStableIcuMessages: (t) => t,
}));

import { aiApi } from '@/services/aiApi';
import VoiceSearch from './VoiceSearch';

const renderVoice = (props = {}) => render(
  <MemoryRouter>
    <IntlProvider locale="en" defaultLocale="en">
      <VoiceSearch {...props} />
    </IntlProvider>
  </MemoryRouter>
);

describe('VoiceSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });

  it('renders the assistant dialog with command library', () => {
    renderVoice();
    expect(screen.getByRole('dialog', { name: 'Voice assistant' })).toBeInTheDocument();
    expect(screen.getByText('Aura Voice Assistant')).toBeInTheDocument();
    expect(screen.getByText('Search for iPhone 15')).toBeInTheDocument();
  });

  it('prefills typed commands from initialCommand', () => {
    renderVoice({ initialCommand: 'show laptops' });
    expect(screen.getByPlaceholderText(/bluetooth headphones/)).toHaveValue('show laptops');
  });

  it('executes typed commands through the AI backend', async () => {
    const onResult = vi.fn();
    const onTelemetryEvent = vi.fn();
    aiApi.chat.mockResolvedValue({ answer: 'Here are phones', actions: [{ type: 'search', query: 'phones' }] });
    renderVoice({ onResult, onTelemetryEvent });

    fireEvent.change(screen.getByPlaceholderText(/bluetooth headphones/), { target: { value: 'find phones' } });
    fireEvent.click(screen.getByRole('button', { name: 'Execute typed command' }));

    await waitFor(() => expect(aiApi.chat).toHaveBeenCalledWith(expect.objectContaining({
      message: 'find phones',
      assistantMode: 'voice',
    })));
    expect(onResult).toHaveBeenCalledWith('phones');
    expect(onTelemetryEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'command_completed' }));
  });

  it('falls back to local handling when the backend fails', async () => {
    const onTelemetryEvent = vi.fn();
    aiApi.chat.mockRejectedValue(new Error('AI down'));
    renderVoice({ onTelemetryEvent });
    fireEvent.change(screen.getByPlaceholderText(/bluetooth headphones/), { target: { value: 'help' } });
    fireEvent.click(screen.getByRole('button', { name: 'Execute typed command' }));

    await waitFor(() => expect(onTelemetryEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command_fallback' })
    ));
    expect(await screen.findByText('Using local voice fallback.')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    renderVoice({ onClose });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('degrades gracefully without speech recognition', async () => {
    renderVoice();
    fireEvent.click(screen.getByRole('button', { name: 'Start listening' }));
    expect(await screen.findByText('Voice commands are not supported in this browser.')).toBeInTheDocument();
  });
});
