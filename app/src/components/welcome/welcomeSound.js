const CHIME_VOLUME = 0.075;
const CHIME_CLOSE_DELAY_MS = 900;

const getAudioContextConstructor = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.AudioContext || window.webkitAudioContext || null;
};

const safeCall = (callback) => {
  try {
    return callback();
  } catch {
    return undefined;
  }
};

const scheduleTone = ({ context, output, frequency, startAt, duration, gain }) => {
  const oscillator = context.createOscillator();
  const toneGain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startAt);

  toneGain.gain.setValueAtTime(0.0001, startAt);
  toneGain.gain.exponentialRampToValueAtTime(gain, startAt + 0.025);
  toneGain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(toneGain);
  toneGain.connect(output);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.04);
};

export const playWelcomeCurtainChime = async () => {
  try {
    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) {
      return false;
    }

    const context = new AudioContextConstructor();

    if (context.state === 'suspended' && typeof context.resume === 'function') {
      await context.resume();
    }

    const now = context.currentTime || 0;
    const output = context.createGain();

    output.gain.setValueAtTime(0.0001, now);
    output.gain.exponentialRampToValueAtTime(CHIME_VOLUME, now + 0.035);
    output.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);
    output.connect(context.destination);

    [
      { frequency: 523.25, delay: 0, duration: 0.42, gain: 0.09 },
      { frequency: 659.25, delay: 0.09, duration: 0.46, gain: 0.075 },
      { frequency: 783.99, delay: 0.18, duration: 0.52, gain: 0.055 },
    ].forEach((tone) => {
      scheduleTone({
        context,
        output,
        frequency: tone.frequency,
        startAt: now + tone.delay,
        duration: tone.duration,
        gain: tone.gain,
      });
    });

    window.setTimeout(() => {
      safeCall(() => output.disconnect());
      const closeResult = safeCall(() => (typeof context.close === 'function' ? context.close() : null));
      if (closeResult && typeof closeResult.catch === 'function') {
        closeResult.catch(() => {});
      }
    }, CHIME_CLOSE_DELAY_MS);

    return true;
  } catch {
    return false;
  }
};
