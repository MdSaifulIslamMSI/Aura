const TRUSTED_DEVICE_CHALLENGE_PATTERNS = [
  'trusted device verification required',
  'fresh trusted device verification is required',
  'cryptographically verified trusted device is required',
  'stronger verified session is required',
];

export const isTrustedDeviceChallengeError = (error) => {
  const status = Number(error?.status || error?.data?.statusCode || 0);
  if (status !== 403) return false;

  const message = `${error?.message || ''} ${error?.data?.message || ''}`.toLowerCase();
  return TRUSTED_DEVICE_CHALLENGE_PATTERNS.some((pattern) => message.includes(pattern));
};

