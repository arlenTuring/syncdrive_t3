#!/usr/bin/env node
/**
 * 舊 class → 設計系統 token 的機械式替換（整理畫面時的輔助工具，不會自動跑）。
 *
 *   node scripts/codemod-design-tokens.mjs <檔案…>          直接改檔
 *   node scripts/codemod-design-tokens.mjs --dry <檔案…>    只列出會改哪些
 *
 * 只處理「意思明確」的對照（文字層級、框線、常見底色、狀態色、字級）。按鈕、選取狀態、
 * 圖表色這類要看上下文的不在這裡，改完務必看畫面。對照表的依據見 t3-ui-design skill。
 */
import { readFileSync, writeFileSync } from 'node:fs';

export const CLASS_MAP = {
  // 文字層級
  'text-white': 'text-text-primary',
  'text-zinc-50': 'text-text-primary',
  'text-zinc-100': 'text-text-primary',
  'text-zinc-200': 'text-text-primary',
  'text-zinc-300': 'text-text-secondary',
  'text-zinc-400': 'text-text-tertiary',
  'text-zinc-500': 'text-text-quaternary',
  'text-zinc-600': 'text-text-disabled',
  'text-gray-100': 'text-text-primary',
  'text-gray-300': 'text-text-secondary',
  'text-gray-400': 'text-text-tertiary',
  'text-gray-500': 'text-text-quaternary',
  'placeholder:text-zinc-500': 'placeholder:text-text-quaternary',
  'placeholder:text-zinc-600': 'placeholder:text-text-quaternary',
  // 主題色文字
  'text-sky-300': 'text-text-theme',
  'text-sky-400': 'text-text-theme',
  'text-blue-400': 'text-text-theme',
  'text-cyan-300': 'text-text-theme',
  'text-cyan-400': 'text-text-theme',
  'text-[#5B9BD5]': 'text-text-theme',
  // 狀態文字
  'text-red-200': 'text-status-error-emphasis',
  'text-red-300': 'text-status-error-emphasis',
  'text-red-400': 'text-status-error-emphasis',
  'text-amber-300': 'text-status-warning',
  'text-amber-400': 'text-status-warning',
  'text-emerald-300': 'text-status-success',
  'text-emerald-400': 'text-status-success',
  // 底色
  'bg-black': 'bg-surface-sub-background',
  'bg-zinc-950': 'bg-surface-sub-background',
  'bg-[#0a0a0b]': 'bg-surface-sub-background',
  'bg-zinc-900': 'bg-surface-primary',
  'bg-zinc-900/90': 'bg-surface-primary',
  'bg-[#121214]': 'bg-surface-primary',
  'bg-[#141416]': 'bg-surface-popup',
  'bg-[#151619]': 'bg-surface-primary',
  'bg-[#17181c]': 'bg-surface-popup',
  'bg-[#18181b]': 'bg-surface-popup',
  'bg-[#1f1f22]': 'bg-surface-secondary',
  'bg-zinc-800': 'bg-surface-secondary',
  'bg-zinc-800/80': 'bg-surface-secondary',
  'bg-[#232933]': 'bg-surface-secondary',
  'bg-[#222831]': 'bg-surface-secondary',
  'bg-white/5': 'bg-link-standard',
  'hover:bg-white/5': 'hover:bg-link-standard',
  'hover:bg-white/10': 'hover:bg-link-standard-hover',
  'hover:bg-zinc-800': 'hover:bg-link-standard-hover',
  'hover:bg-zinc-700': 'hover:bg-link-standard-hover',
  'bg-[#1a3a5c]': 'bg-link-tonal',
  'bg-sky-500/15': 'bg-surface-theme',
  'bg-sky-600/15': 'bg-surface-theme',
  'bg-sky-600/20': 'bg-link-tonal',
  'bg-red-500': 'bg-status-error',
  'bg-red-500/10': 'bg-status-error-light',
  'bg-red-500/15': 'bg-status-error-light',
  // 框線
  'border-zinc-600': 'border-border-tertiary',
  'border-zinc-700': 'border-border-quaternary',
  'border-zinc-700/90': 'border-border-quaternary',
  'border-zinc-800': 'border-border-quaternary',
  'border-zinc-800/80': 'border-border-quaternary',
  'border-zinc-800/90': 'border-border-quaternary',
  'border-white/10': 'border-border-quaternary',
  'border-sky-500/60': 'border-border-theme-light',
  'border-blue-500': 'border-border-theme',
  'focus:border-blue-500': 'focus:border-border-theme',
  'focus:border-sky-500': 'focus:border-border-theme',
  'border-red-500/20': 'border-border-danger-light',
  // 陰影
  'shadow-black/50': 'shadow-black-50',
  // 字級（設計稿沒有的字級改成最接近的；固定尺寸容器要人工確認）
  'text-[9px]': 'text-caption-2',
  'text-[10px]': 'text-caption-2',
  'text-[11px]': 'text-body-xs',
  'text-[12px]': 'text-body-xs',
  'text-xs': 'text-body-xs',
  'text-[13px]': 'text-body-s',
  'text-[14px]': 'text-body-s',
  'text-sm': 'text-body-s',
  'text-[15px]': 'text-body-m',
  'text-base': 'text-body-m',
  'text-[17px]': 'text-headline-5',
  'text-lg': 'text-headline-5',
  'text-xl': 'text-headline-4',
  'text-2xl': 'text-headline-3',
};

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\/#]/g, '\\$&');
// 前面不能是 class 字元（避免吃到 hover:text-zinc-100 以外的長名稱），後面不能接 class 字元或 /透明度
const PATTERNS = Object.entries(CLASS_MAP)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([from, to]) => [new RegExp(`(?<![\\w\\-\\[#/:])${escape(from)}(?![\\w\\-/\\]])`, 'g'), to, from]);

export function migrate(text) {
  let out = text;
  const hits = {};
  for (const [pattern, to, from] of PATTERNS) {
    out = out.replace(pattern, () => {
      hits[from] = (hits[from] ?? 0) + 1;
      return to;
    });
  }
  // 變體前綴 + 對照表裡的 class
  out = out.replace(/(?<![\w\-[#/])((?:[a-z0-9-]+:)+)([a-z][\w\-[\]#/.]*)/g, (whole, prefix, cls) => {
    if (!(cls in CLASS_MAP) || `${prefix}${cls}` in CLASS_MAP) return whole;
    hits[`${prefix}${cls}`] = (hits[`${prefix}${cls}`] ?? 0) + 1;
    return `${prefix}${CLASS_MAP[cls]}`;
  });
  return { text: out, hits };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  for (const file of args.filter((arg) => arg !== '--dry')) {
    const before = readFileSync(file, 'utf8');
    const { text, hits } = migrate(before);
    const total = Object.values(hits).reduce((a, b) => a + b, 0);
    if (!dry && text !== before) writeFileSync(file, text);
    console.log(`${file}: ${total} 處${total ? `（${Object.entries(hits).map(([k, v]) => `${k}×${v}`).join('、')}）` : ''}`);
  }
}
