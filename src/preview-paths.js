// Normalize preview links without depending on a Node runtime.
export function previewDirname(path) {
  const normalized = path.replaceAll('\\', '/');
  const parent = normalized.slice(0, normalized.lastIndexOf('/'));
  return /^[a-z]:$/i.test(parent) ? `${parent}/` : parent || '/';
}

export function resolvePreviewPath(base, relative) {
  base = base.replaceAll('\\', '/');
  relative = relative.replaceAll('\\', '/');
  let full = /^(?:[a-z]:\/|\/)/i.test(relative) ? relative : `${base}/${relative}`;
  const drive = full.match(/^[a-z]:/i)?.[0];
  const unc = !drive && full.startsWith('//');
  if (drive) full = full.slice(2);
  const parts = [];
  for (const part of full.split('/')) {
    if (part === '..') {
      if (parts.length > (unc ? 2 : 0)) parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return (drive ? `${drive}/` : unc ? '//' : '/') + parts.join('/');
}
