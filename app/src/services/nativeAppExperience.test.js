import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getNotificationPermission,
  isAuraDesktopRuntime,
  registerAndroidBackButtonHandler,
  requestCallMediaReadiness,
  requestNativeNotificationPermission,
  requestUserNotificationPermission,
  showSystemNotification,
} from './nativeAppExperience';

const backListeners = [];
const exitApp = vi.fn();
const registerPush = vi.fn();

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn((event, callback) => {
      if (event === 'backButton') {
        backListeners.push(callback);
      }
      return Promise.resolve({ remove: vi.fn() });
    }),
    exitApp,
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions: vi.fn(async () => ({ receive: 'granted' })),
    register: (...args) => registerPush(...args),
  },
}));

const goNative = (platform = 'android') => {
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => platform,
  };
};

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

  it('registers no back-button handler outside the native runtime', () => {
    const cleanup = registerAndroidBackButtonHandler();
    expect(typeof cleanup).toBe('function');
    cleanup();
    expect(backListeners).toHaveLength(0);
  });

  it('exits the app from a tab root on Android back', async () => {
    goNative();
    window.history.replaceState(null, '', '/');
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const cleanup = registerAndroidBackButtonHandler();
    await vi.waitFor(() => expect(backListeners.length).toBe(1));

    backListeners[0]();
    expect(exitApp).toHaveBeenCalledTimes(1);
    expect(historyBack).not.toHaveBeenCalled();
    historyBack.mockRestore();
    cleanup();
  });

  it('navigates back instead of exiting on inner flows', async () => {
    goNative();
    window.history.replaceState(null, '', '/product/aura-headphones');
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const cleanup = registerAndroidBackButtonHandler();
    await vi.waitFor(() => expect(backListeners.length).toBe(2));

    backListeners[1]();
    expect(historyBack).toHaveBeenCalledTimes(1);
    expect(exitApp).not.toHaveBeenCalled();
    historyBack.mockRestore();
    cleanup();
  });

  it('returns unsupported for native notification permission off-device', async () => {
    delete window.Capacitor;
    await expect(requestNativeNotificationPermission()).resolves.toEqual({
      supported: false,
      permission: 'unsupported',
    });
    expect(registerPush).not.toHaveBeenCalled();
  });

  it('requests the Android 13+ permission and registers for push when granted', async () => {
    goNative();
    await expect(requestNativeNotificationPermission()).resolves.toEqual({
      supported: true,
      permission: 'granted',
    });
    expect(registerPush).toHaveBeenCalledTimes(1);
  });

  it('keeps the granted permission result even when FCM registration fails', async () => {
    goNative();
    registerPush.mockRejectedValueOnce(new Error('google-services.json missing'));
    await expect(requestNativeNotificationPermission()).resolves.toEqual({
      supported: true,
      permission: 'granted',
    });
  });
});
