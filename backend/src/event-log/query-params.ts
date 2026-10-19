import { BadRequestException } from '@nestjs/common';
import { PAGE_SIZE_MAX, QUERY_SPAN_MAX_MS } from './event-log.constants';

/** 查詢參數驗證：epoch 毫秒時間區間（起點含、終點不含）、分頁、白名單排序 */
export function epochParam(raw: unknown, label: string): number {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{10,15}$/.test(text)) throw new BadRequestException(`${label}必須是 epoch 毫秒`);
  const value = Number(text);
  if (value < 1_000_000_000_000) throw new BadRequestException(`${label}必須是 epoch 毫秒（不是秒）`);
  return value;
}

export function rangeParams(from: unknown, to: unknown) {
  const start = epochParam(from, '開始時間');
  const end = epochParam(to, '結束時間');
  if (end <= start) throw new BadRequestException('結束時間必須晚於開始時間');
  if (end - start > QUERY_SPAN_MAX_MS) throw new BadRequestException('查詢區間最長 400 天');
  return { from: start, to: end };
}

export function pageParams(page: unknown, pageSize: unknown, defaultSize: number) {
  const p = page === undefined || page === '' ? 1 : Number(page);
  const s = pageSize === undefined || pageSize === '' ? defaultSize : Number(pageSize);
  if (!Number.isInteger(p) || p < 1 || p > 100_000) throw new BadRequestException('頁碼不正確');
  if (!Number.isInteger(s) || s < 1 || s > PAGE_SIZE_MAX) throw new BadRequestException(`每頁筆數須為 1–${PAGE_SIZE_MAX}`);
  return { page: p, pageSize: s };
}

export function enumParam<T extends string>(raw: unknown, allowed: readonly T[], label: string): T | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) throw new BadRequestException(`${label}不正確`);
  return raw as T;
}

export function textParam(raw: unknown, label: string, max = 120): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') throw new BadRequestException(`${label}不正確`);
  const value = raw.trim();
  if (!value) return undefined;
  if (value.length > max) throw new BadRequestException(`${label}最多 ${max} 字`);
  return value;
}

export function boolParam(raw: unknown, label: string): boolean | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new BadRequestException(`${label}不正確`);
}

/** 拒絕這一類不適用的條件（不默默忽略造成查錯資料） */
export function rejectUnknown(query: Record<string, unknown>, allowed: string[]) {
  const extra = Object.keys(query).filter((key) => !allowed.includes(key) && query[key] !== undefined && query[key] !== '');
  if (extra.length) throw new BadRequestException(`這一類不支援的查詢條件：${extra.join('、')}`);
}

export function likePattern(value: string) {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
