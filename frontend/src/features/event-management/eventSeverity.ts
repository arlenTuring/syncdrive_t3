/** 嚴重度的顯示名稱（依設計稿：INFO 顯示為「一般」） */
export const SEVERITY_LABEL: Record<string, string> = { CRITICAL: '嚴重', WARNING: '警告', INFO: '一般' };
export const SEVERITY_OPTIONS = [
  { value: 'CRITICAL', label: '嚴重' },
  { value: 'WARNING', label: '警告' },
  { value: 'INFO', label: '一般' },
] as const;

/** SOP 連結只接受 http／https，避免 javascript: 之類的網址 */
export function isHttpUrl(text: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(text).protocol);
  } catch {
    return false;
  }
}
