const TRUSTED_DEVICE_CHALLENGE_PATTERNS = [
  'trusted device verification required',
  'fresh trusted device verification is required',
  'cryptographically verified trusted device is required',
  'stronger verified session is required',
];

const DUO_STEP_UP_PATTERNS = [
  'duo step-up verification is required',
  'duo step-up required',
  'duo verification is required',
];

export const isTrustedDeviceChallengeError = (error) => {
  const status = Number(error?.status || error?.data?.statusCode || 0);
  if (status !== 403) return false;

  const message = `${error?.message || ''} ${error?.data?.message || ''}`.toLowerCase();
  return TRUSTED_DEVICE_CHALLENGE_PATTERNS.some((pattern) => message.includes(pattern));
};

export const isDuoStepUpRequiredError = (error) => {
  const status = Number(error?.status || error?.data?.statusCode || 0);
  if (status !== 403) return false;

  const code = String(error?.code || error?.data?.code || '').trim().toUpperCase();
  const feature = String(error?.feature || error?.data?.feature || '').trim().toLowerCase();
  if (code === 'DUO_STEP_UP_REQUIRED' || feature === 'duo_step_up') {
    return true;
  }

  const message = `${error?.message || ''} ${error?.data?.message || ''}`.toLowerCase();
  return DUO_STEP_UP_PATTERNS.some((pattern) => message.includes(pattern));
};
