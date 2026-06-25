/** `<input type="color">` 僅接受 #rrggbb；transparent 等值會導致受控元件異常 */
export function toColorInputHex(color: string | undefined, fallback = '#0c121c'): string {
  if (!color) return fallback;
  if (color === 'transparent') return fallback;
  if (color.startsWith('#') && /^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (color.startsWith('#') && /^#[0-9a-fA-F]{3}$/.test(color)) {
    const [, r, g, b] = color;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return fallback;
  const hex = (n: string) => Number(n).toString(16).padStart(2, '0');
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
}

export function isTransparentColor(color: string | undefined): boolean {
  return color === 'transparent';
}
