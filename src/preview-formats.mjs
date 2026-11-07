export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'];
export function previewKind(path) {
  const extension = String(path).split('.').pop().toLowerCase();
  if (['md', 'markdown', 'mdown'].includes(extension)) return 'markdown';
  if (extension === 'pdf') return 'pdf';
  return IMAGE_EXTENSIONS.includes(extension) ? 'image' : null;
}
