/** 合併 class：略過 false／null／undefined／空字串 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
