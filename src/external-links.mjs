// All external navigation uses the same scheme allowlist, including OSC 8 links.
export function normalizeExternalUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname
      ? url.href : null;
  } catch {
    return null;
  }
}
