// Feed recovery into the display parser, never into the shell's stdin.
export const RESET_MOUSE_MODES = '\x1b[?9;1000;1002;1003;1004;1006;1016l';

export function encodeTerminalInput(data, binary = false) {
  const bytes = binary
    ? Uint8Array.from(data, character => character.charCodeAt(0) & 0xff)
    : new TextEncoder().encode(data);
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw);
}
