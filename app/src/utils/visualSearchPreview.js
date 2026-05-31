export const toSafePreviewImage = (value = '') => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (normalized.startsWith('blob:')) return normalized;
  try {
    const url = new URL(normalized);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};
