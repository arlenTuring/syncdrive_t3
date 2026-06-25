/** 匯出檔名用時間戳（本地時間 YYYY-MM-DD_HHmmss，不含冒號以便跨平台） */
export function exportFilenameTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** 將顯示名稱轉為檔名安全片段 */
export function sanitizeExportLabel(label: string, fallback = 'export'): string {
  const base = label
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fff\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || fallback;
}

/** 組合匯出檔名：`{label}[-{kind}]-{timestamp}.{ext}` */
export function buildExportFilename(
  label: string,
  opts?: { kind?: string; ext?: string; date?: Date },
): string {
  const stamp = exportFilenameTimestamp(opts?.date);
  const safeLabel = sanitizeExportLabel(label);
  const kind = opts?.kind ? `-${opts.kind}` : '';
  const ext = opts?.ext ?? 'json';
  return `${safeLabel}${kind}-${stamp}.${ext}`;
}
