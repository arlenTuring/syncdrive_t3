import { BadRequestException } from '@nestjs/common';

/**
 * 回放游標：(時間, 序號)。序號是 PostgreSQL bigint，一律以十進位字串傳遞與比較，
 * 不轉成 JavaScript Number（超過 2^53 會失真）。
 */
export const MAX_SEQ = '9223372036854775807';

export function parseSeq(value: unknown, name = 'seq'): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!/^\d{1,19}$/.test(text)) throw new BadRequestException(`${name} 必須是非負整數字串`);
  const normalized = text.replace(/^0+(?=\d)/, '');
  if (normalized.length === 19 && normalized > MAX_SEQ) throw new BadRequestException(`${name} 超出範圍`);
  return normalized;
}

export function parseEpochMs(value: unknown, name: string): number {
  const number = Number(value);
  if (value === undefined || value === '' || value === null || !Number.isSafeInteger(Math.floor(number)))
    throw new BadRequestException(`${name} 必須是 Epoch 毫秒`);
  return Math.floor(number);
}

/**
 * 帶時區的日期時間（ISO 8601，必須有 Z 或 ±hh:mm），例如 2026-10-15T08:00:00+08:00。
 * 不接受沒有時區的字串——那會被伺服器所在時區解讀，跟使用者畫面上的時間對不起來。
 */
export function parseZonedDateTime(value: unknown, name: string): number {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(text))
    throw new BadRequestException(`${name} 必須是帶時區的日期時間（例如 2026-10-15T08:00:00+08:00）`);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new BadRequestException(`${name} 不是有效的日期時間`);
  return ms;
}

/** 比較兩個序號字串（都是正規化過的十進位） */
export function compareSeq(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}
