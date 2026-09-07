import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSpeechInput } from './useSpeechInput';

const installRecognition = (impl = {}) => {
  const listeners = {};
  const recognition = {
    continuous: false,
    interimResults: true,
    lang: '',
    start: vi.fn(),
    stop: vi.fn(),
    onresult: null,
    onerror: null,
    onend: null,
    ...impl,
  };
  const SpeechRecognition = vi.fn(function () { return recognition; });
  vi.stubGlobal('SpeechRecognition', SpeechRecognition);
  delete window.webkitSpeechRecognition;
  return { recognition, SpeechRecognition };
};

describe('useSpeechInput', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports unsupported when no recognition API exists', () => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    const { result } = renderHook(() => useSpeechInput({ value: '', onChange: vi.fn() }));
    expect(result.current.supportsSpeechInput).toBe(false);
    expect(result.current.startListening()).toBe(false);
  });

  it('starts and stops listening with the current value as prefix', () => {
    const { recognition } = installRecognition();
    const onChange = vi.fn();
    const { result } = renderHook(() => useSpeechInput({ value: 'hello', onChange }));

    let started;
    act(() => { started = result.current.startListening(); });
    expect(started).toBe(true);
    expect(result.current.isListening).toBe(true);
    expect(recognition.start).toHaveBeenCalledOnce();

    // Simulate a transcript; prefix should be prepended.
    const event = { results: [[{ transcript: 'world' }]] };
    act(() => { recognition.onresult(event); });
    expect(onChange).toHaveBeenCalledWith('hello world');

    let stopped;
    act(() => { stopped = result.current.stopListening(); });
    expect(stopped).toBe(true);
    expect(result.current.isListening).toBe(false);
  });

  it('clears the value on start when clearOnStart is set', () => {
    installRecognition();
    const onChange = vi.fn();
    const { result } = renderHook(() => useSpeechInput({ value: 'keep me', onChange, clearOnStart: true }));

    act(() => { result.current.startListening(); });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('toggles listening state', () => {
    installRecognition();
    const { result } = renderHook(() => useSpeechInput({ value: '', onChange: vi.fn() }));

    let first;
    act(() => { first = result.current.toggleListening(); });
    expect(first).toBe(true);
    expect(result.current.isListening).toBe(true);

    let second;
    act(() => { second = result.current.toggleListening(); });
    expect(second).toBe(false);
    expect(result.current.isListening).toBe(false);
  });

  it('handles recognition errors by stopping', () => {
    const { recognition } = installRecognition();
    const { result } = renderHook(() => useSpeechInput({ value: '', onChange: vi.fn() }));

    act(() => { result.current.startListening(); });
    expect(result.current.isListening).toBe(true);
    act(() => { recognition.onerror({}); });
    expect(result.current.isListening).toBe(false);
  });

  it('returns false when start throws (e.g. already started)', () => {
    installRecognition({ start: vi.fn(() => { throw new Error('busy'); }) });
    const { result } = renderHook(() => useSpeechInput({ value: '', onChange: vi.fn() }));

    let started;
    act(() => { started = result.current.startListening(); });
    expect(started).toBe(false);
    expect(result.current.isListening).toBe(false);
  });

  it('supports webkit prefix implementations', () => {
    delete window.SpeechRecognition;
    const recognition = { start: vi.fn(), stop: vi.fn(), onresult: null, onerror: null, onend: null };
    window.webkitSpeechRecognition = vi.fn(function () { return recognition; });
    const { result } = renderHook(() => useSpeechInput({ value: '', onChange: vi.fn() }));
    expect(result.current.supportsSpeechInput).toBe(true);
    delete window.webkitSpeechRecognition;
  });
});
