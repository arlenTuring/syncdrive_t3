import { buildExportFilename } from '../../../lib/exportFilename';

/** 導出檔名：安全字元 + 匯出時間戳 */
export function sanitizeMapExportFilename(displayName: string, date = new Date()): string {
  return buildExportFilename(displayName || 'syncdrive-map', { date });
}
