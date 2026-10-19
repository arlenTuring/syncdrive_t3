/**
 * CSV 產生：UTF-8 BOM、RFC 4180 引號／換行跳脫。
 *
 * 試算表公式注入：人類可讀欄位若以 = + - @ Tab CR 開頭，前面加一個單引號，避免被 Excel 當公式執行；
 * 機器原值欄位（ID、代碼、epoch 毫秒）不加。檔案第一列欄位說明會註明這個規則，需要原值時去掉開頭單引號即可還原。
 */
export type CsvColumn<T> = { header: string; value: (row: T) => unknown; raw?: boolean };

const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: unknown, raw = false): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (!raw && FORMULA.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header, true)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row), c.raw)).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** 依時區格式化成 YYYY-MM-DD HH:mm:ss（完整日期與秒） */
export function formatInZone(epochMs: number | null | undefined, timeZone: string): string {
  if (epochMs === null || epochMs === undefined || !Number.isFinite(epochMs)) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(epochMs));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export function exportFileName(prefix: string, timeZone: string, now = Date.now()) {
  return `${prefix}-${formatInZone(now, timeZone).replace(/[-: ]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2')}.csv`;
}
