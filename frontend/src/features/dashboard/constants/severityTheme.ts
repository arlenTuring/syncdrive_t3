/** 嚴重度等級 → 儀表板配色（前端對照，不由資料庫輸出色碼） */

export type SeverityLevel = 'CRITICAL' | 'WARNING' | 'INFO';

export interface SeverityStyle {
  stripBg: string;
  stripText: string;
  label: string;
}

const STYLES: Record<SeverityLevel, SeverityStyle> = {
  CRITICAL: { stripBg: '#dc2626', stripText: '#ffffff', label: 'Critical' },
  WARNING: { stripBg: '#f97316', stripText: '#0f172a', label: 'Warning' },
  INFO: { stripBg: '#64748b', stripText: '#0f172a', label: 'Info' },
};

export function normalizeSeverity(raw: unknown): SeverityLevel {
  const s = String(raw ?? 'INFO').toUpperCase();
  if (s === 'CRITICAL' || s === 'WARNING' || s === 'INFO') return s;
  return 'INFO';
}

export function getSeverityStyle(raw: unknown): SeverityStyle {
  return STYLES[normalizeSeverity(raw)];
}
