import { isCapacitorNativeRuntime } from '../utils/nativeRuntime';

const DEFAULT_NOTIFICATION_ICON = '/assets/icon-512.png';
const DEFAULT_NOTIFICATION_BADGE = '/assets/icon-192.png';

const hasWindow = () => typeof window !== 'undefined';
const hasDocument = () => typeof document !== 'undefined';

const stopStreamTracks = (stream) => {
  stream?.getTracks?.().forEach((track) => {
    try {
      track.stop();
    } catch {
      // Media tracks can already be stopped by the browser/runtime.
    }
  });
};

const formatMediaAccessMessage = (error, wantsVideo) => {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').trim();

  if (name.includes('notallowed') || name.includes('security')) {
    return wantsVideo
      ? 'Camera and microphone permission is needed before Aura can start the live call.'
      : 'Microphone permission is needed before Aura can start the live call.';
  }

  if (name.includes('notfound') || name.includes('devicesnotfound')) {
    return wantsVideo
      ? 'Aura could not find a usable camera or microphone on this device.'
      : 'Aura could not find a usable microphone on this device.';
  }

  if (name.includes('notreadable') || name.includes('trackstart')) {
    return 'Another app may be using your camera or microphone. Close it, then try the call again.';
  }

  return message || 'Aura could not prepare camera or microphone access for the live call.';
};

export const isAuraDesktopRuntime = () => (
  hasWindow() && Boolean(window.auraDesktop?.isDesktop)
);

export const isInstalledAppRuntime = () => (
  isAuraDesktopRuntime() || isCapacitorNativeRuntime()
);

export const getNotificationPermission = () => {
  if (!hasWindow() || typeof window.Notification !== 'function') {
    return 'unsupported';
  }

  return window.Notification.permission || 'default';
};

export const requestUserNotificationPermission = async () => {
  if (!hasWindow() || typeof window.Notification !== 'function') {
    return 'unsupported';
  }

  const currentPermission = getNotificationPermission();
  if (currentPermission !== 'default') {
    return currentPermission;
  }

  if (typeof window.Notification.requestPermission !== 'function') {
    return currentPermission;
  }

  try {
    return await window.Notification.requestPermission();
  } catch {
    return getNotificationPermission();
  }
};

export const shouldUseSystemNotification = () => {
  if (!hasDocument()) {
    return true;
  }

  return document.visibilityState !== 'visible' || isInstalledAppRuntime();
};

export const showSystemNotification = async ({
  title,
  body = '',
  tag = '',
  data = null,
  requireBackground = false,
} = {}) => {
  const resolvedTitle = String(title || '').trim();
  if (!resolvedTitle || !hasWindow() || typeof window.Notification !== 'function') {
    return false;
  }

  if (requireBackground && !shouldUseSystemNotification()) {
    return false;
  }

  let permission = getNotificationPermission();
  if (permission === 'default' && isInstalledAppRuntime()) {
    permission = await requestUserNotificationPermission();
  }

  if (permission !== 'granted') {
    return false;
  }

  try {
    const notification = new window.Notification(resolvedTitle, {
      badge: DEFAULT_NOTIFICATION_BADGE,
      body: String(body || ''),
      data,
      icon: DEFAULT_NOTIFICATION_ICON,
      tag: tag || undefined,
    });

    notification.onclick = () => {
      window.focus?.();
    };

    return true;
  } catch {
    return false;
  }
};

export const requestCallMediaReadiness = async ({ video = true } = {}) => {
  const wantsVideo = Boolean(video);
  if (
    !hasWindow()
    || typeof navigator === 'undefined'
    || typeof navigator.mediaDevices?.getUserMedia !== 'function'
  ) {
    return {
      ok: false,
      message: 'This app runtime does not expose camera or microphone capture.',
    };
  }

  let audioStream = null;
  let videoStream = null;
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });

    if (wantsVideo) {
      try {
        videoStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'user' },
        });
      } catch (error) {
        return {
          ok: true,
          message: '',
          warning: formatMediaAccessMessage(error, true),
        };
      }
    }

    return {
      ok: true,
      message: '',
      warning: '',
    };
  } catch (error) {
    return {
      ok: false,
      error,
      message: formatMediaAccessMessage(error, wantsVideo),
    };
  } finally {
    stopStreamTracks(audioStream);
    stopStreamTracks(videoStream);
  }
};

export const addNativeAppResumeListener = (callback) => {
  if (typeof callback !== 'function' || !isCapacitorNativeRuntime()) {
    return () => {};
  }

  let cancelled = false;
  const handles = [];

  const addHandle = (handle) => {
    if (!handle) return;
    if (cancelled) {
      handle.remove?.();
      return;
    }
    handles.push(handle);
  };

  import('@capacitor/app')
    .then(({ App }) => {
      if (cancelled || !App?.addListener) {
        return;
      }

      Promise.resolve(App.addListener('appStateChange', (state = {}) => {
        if (state.isActive) {
          callback({ source: 'appStateChange' });
        }
      })).then(addHandle).catch(() => {});

      Promise.resolve(App.addListener('resume', () => {
        callback({ source: 'resume' });
      })).then(addHandle).catch(() => {});
    })
    .catch(() => {});

  return () => {
    cancelled = true;
    handles.splice(0).forEach((handle) => {
      try {
        handle.remove?.();
      } catch {
        // Best-effort native listener cleanup.
      }
    });
  };
};

const DEFAULT_BACK_EXIT_ROOTS = ['/', '/search', '/market', '/cart', '/account'];

export const registerAndroidBackButtonHandler = ({ exitRoots = DEFAULT_BACK_EXIT_ROOTS } = {}) => {
  if (!isCapacitorNativeRuntime() || !hasWindow()) {
    return () => {};
  }

  let cancelled = false;
  let handle = null;
  const exitRootSet = new Set(
    (Array.isArray(exitRoots) && exitRoots.length ? exitRoots : DEFAULT_BACK_EXIT_ROOTS)
      .map((root) => String(root).replace(/\/+$/, '') || '/')
  );

  const isExitRoot = (pathname = '') => exitRootSet.has(String(pathname).replace(/\/+$/, '') || '/');

  import('@capacitor/app')
    .then(({ App }) => {
      if (cancelled || !App?.addListener || typeof App.exitApp !== 'function') {
        return;
      }

      return Promise.resolve(App.addListener('backButton', () => {
        const pathname = window.location?.pathname || '/';
        if (isExitRoot(pathname)) {
          // Hardware back on a tab root leaves the app, matching Android
          // navigation conventions everywhere else the user would be stuck.
          App.exitApp();
          return;
        }
        // Product, checkout, and other inner flows always navigate back
        // instead of closing the app.
        window.history.back();
      })).then((registered) => {
        handle = registered;
      }).catch(() => {});
    })
    .catch(() => {});

  return () => {
    cancelled = true;
    try {
      handle?.remove?.();
    } catch {
      // Best-effort native listener cleanup.
    }
    handle = null;
  };
};

export const requestNativeNotificationPermission = async () => {
  if (!isCapacitorNativeRuntime()) {
    return { supported: false, permission: 'unsupported' };
  }

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    if (!PushNotifications?.requestPermissions) {
      return { supported: false, permission: 'unsupported' };
    }

    const result = await PushNotifications.requestPermissions();
    const permission = String(result?.receive || 'denied').toLowerCase();

    if (permission === 'granted') {
      try {
        // Registers with FCM for push tokens. Without google-services.json the
        // registration fails; the runtime permission result still stands and
        // foreground Web notifications keep working.
        await PushNotifications.register();
      } catch {
        // FCM credentials are not configured yet — foreground lane only.
      }
    }

    return { supported: true, permission };
  } catch {
    return { supported: false, permission: 'unsupported' };
  }
};
