let fallbackCounter = 0;

const createEntropy = () => {
  const cryptoRef = globalThis.crypto;
  if (typeof cryptoRef?.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  if (typeof cryptoRef?.getRandomValues === 'function') {
    const bytes = new Uint8Array(12);
    cryptoRef.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  fallbackCounter += 1;
  return `${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
};

export const createRuntimeId = (prefix = 'id') => `${prefix}-${Date.now()}-${createEntropy()}`;
