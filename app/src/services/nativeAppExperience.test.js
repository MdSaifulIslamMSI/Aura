import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getNotificationPermission,
  isAuraDesktopRuntime,
  requestCallMediaReadiness,
  requestUserNotificationPermission,
  showSystemNotification,
} from './nativeAppExperience';

describe('nativeAppExperience', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    delete window.auraDesktop;
  });

  it('detects the Aura desktop bridge', () => {
    expect(isAuraDesktopRuntime()).toBe(false);

    window.auraDesktop = { isDesktop: true };

    expect(isAuraDesktopRuntime()).toBe(true);
  });

  it('returns unsupported when system notifications are unavailable', () => {
    vi.stubGlobal('Notification', undefined);

    expect(getNotificationPermission()).toBe('unsupported');
  });

  it('requests notification permission when the runtime has not decided yet', async () => {
    class MockNotification {}
    MockNotification.permission = 'default';
    MockNotification.requestPermission = vi.fn(async () => 'granted');
    vi.stubGlobal('Notification', MockNotification);

    await expect(requestUserNotificationPermission()).resolves.toBe('granted');
    expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('shows a system notification after permission is granted', async () => {
    const instances = [];
    class MockNotification {
      static permission = 'granted';

      constructor(title, options) {
        instances.push({ title, options });
      }
    }
    vi.stubGlobal('Notification', MockNotification);

    await expect(showSystemNotification({
      title: 'Incoming Aura call',
      body: 'Support is calling',
      tag: 'call-1',
    })).resolves.toBe(true);

    expect(instances).toEqual([
      expect.objectContaining({
        title: 'Incoming Aura call',
        options: expect.objectContaining({
          body: 'Support is calling',
          tag: 'call-1',
        }),
      }),
    ]);
  });

  it('warms call media permission and stops probe tracks', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop }],
    }));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    await expect(requestCallMediaReadiness({ video: true })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        message: '',
        warning: '',
      })
    );

    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: true,
      video: false,
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: false,
      video: { facingMode: 'user' },
    });
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('returns a helpful media permission message when capture is denied', async () => {
    const getUserMedia = vi.fn(async () => {
      const error = new Error('Permission denied');
      error.name = 'NotAllowedError';
      throw error;
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    await expect(requestCallMediaReadiness({ video: false })).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        message: 'Microphone permission is needed before Aura can start the live call.',
      })
    );
  });
});
