#!/usr/bin/env node
/**
 * 舊 class → 設計系統 token 的機械式替換（整理畫面時的輔助工具，不會自動跑）。
 *
 *   node scripts/codemod-design-tokens.mjs <檔案…>          直接改檔
 *   node scripts/codemod-design-tokens.mjs --dry <檔案…>    只列出會改哪些
 *   加 --families：對照表沒有的色票依色系換成語意 token（見 familyToken）
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
  // 狀態色（第二批補充）
  'text-rose-200': 'text-status-error-emphasis',
  'text-rose-300': 'text-status-error-emphasis',
  'text-rose-400': 'text-status-error-emphasis',
  'text-emerald-200': 'text-status-success',
  'text-amber-100': 'text-status-warning',
  'text-amber-200': 'text-status-warning',
  'text-sky-200': 'text-text-theme',
  'bg-rose-950/50': 'bg-status-error-light',
  'bg-red-500/20': 'bg-status-error-light',
  'bg-amber-950/30': 'bg-status-warning-light',
  'bg-amber-500/10': 'bg-status-warning-light',
  'bg-emerald-500/10': 'bg-status-success-light',
  'bg-emerald-400': 'bg-status-success',
  'bg-amber-400': 'bg-status-warning',
  'bg-sky-400': 'bg-border-theme',
  'bg-sky-500/5': 'bg-surface-theme-light',
  'bg-sky-500/10': 'bg-surface-theme',
  'hover:bg-sky-500/10': 'hover:bg-surface-theme',
  'border-rose-500/40': 'border-border-danger-light',
  'border-rose-700': 'border-border-danger-light',
  'border-rose-800': 'border-border-danger-light',
  'border-red-400/40': 'border-border-danger-light',
  'border-red-500/30': 'border-border-danger-light',
  'border-amber-500/30': 'border-status-warning-light',
  'border-amber-800': 'border-status-warning-light',
  'border-amber-900': 'border-status-warning-light',
  'border-emerald-500/30': 'border-status-success-light',
  'border-emerald-800': 'border-status-success-light',
  'border-sky-400': 'border-border-theme',
  'border-sky-500': 'border-border-theme',
  'border-sky-500/30': 'border-border-theme-light-trn',
  'border-sky-700': 'border-border-theme-light',
  'border-sky-800': 'border-border-theme-light',
  'focus:border-sky-500/70': 'focus:border-border-theme',
  'focus:ring-sky-500': 'focus:ring-border-theme',
  // 深色底（第二批補充）
  'bg-[#101012]': 'bg-surface-sub-background',
  'bg-[#1a1a1d]': 'bg-surface-primary',
  'bg-[#1c1c1f]': 'bg-surface-primary',
  'bg-[#232730]': 'bg-surface-secondary',
  'bg-[#2a2e37]': 'bg-link-standard-hover',
  'hover:bg-[#323743]': 'hover:bg-link-standard-pressed',
  'bg-zinc-900/60': 'bg-surface-primary',
  'bg-zinc-900/80': 'bg-surface-primary',
  'bg-zinc-950/95': 'bg-surface-popup',
  'bg-zinc-700': 'bg-link-standard-hover',
  'bg-zinc-700/40': 'bg-link-standard',
  'bg-zinc-700/80': 'bg-link-standard-hover',
  'border-zinc-600/50': 'border-border-quaternary',
  'border-zinc-900': 'border-border-quaternary',
  'hover:border-zinc-600': 'hover:border-border-tertiary',
  'fill-zinc-500': 'fill-text-quaternary',
  'text-[28px]': 'text-headline-2',
  // 第三批補充（媒體、影像）
  'bg-[#262a33]': 'bg-surface-secondary',
  'bg-[#27303d]': 'bg-surface-secondary',
  'bg-[#2a3445]': 'bg-surface-secondary',
  'bg-[#1b1d23]': 'bg-surface-primary',
  'bg-[#1c2028]': 'bg-surface-primary',
  'bg-[#16181d]': 'bg-surface-primary',
  'hover:bg-[#2d323d]': 'hover:bg-link-standard-hover',
  'hover:bg-[#2b313b]': 'hover:bg-link-standard-hover',
  'accent-blue-600': 'accent-link-theme-filled',
  'ring-blue-500': 'ring-border-theme',
  'ring-sky-500': 'ring-border-theme',
  'ring-blue-500/60': 'ring-border-theme-light',
  'focus:ring-blue-500': 'focus:ring-border-theme',
  'border-zinc-500': 'border-border-primary',
  'border-zinc-700/60': 'border-border-quaternary',
  'border-zinc-700/70': 'border-border-quaternary',
  'text-blue-200': 'text-text-theme',
  'text-blue-300': 'text-text-theme',
  'text-sky-100': 'text-text-theme',
  'text-red-100': 'text-status-error-emphasis',
  'text-red-500': 'text-status-error',
  'text-amber-200/80': 'text-status-warning',
  'border-amber-300': 'border-status-warning',
  'border-amber-500/40': 'border-status-warning-light',
  'border-red-500': 'border-status-error',
  'border-sky-500/40': 'border-border-theme-light',
  'bg-amber-500/15': 'bg-status-warning-light',
  'bg-blue-500/10': 'bg-surface-theme',
  'bg-blue-500/15': 'bg-surface-theme',
  'bg-sky-500/60': 'bg-link-tonal-pressed',
  'bg-red-900/40': 'bg-status-error-light',
  'bg-red-900/70': 'bg-status-error-light',
  'bg-red-500/60': 'bg-status-error-light',
  'bg-emerald-500/70': 'bg-status-success-light',
  'bg-zinc-500/40': 'bg-link-standard-hover',
  'bg-zinc-600': 'bg-link-black-filled-hover',
  'bg-zinc-700/60': 'bg-link-standard-hover',
  'bg-white/10': 'bg-link-standard-hover',
  'hover:bg-white/20': 'hover:bg-link-standard-pressed',
  'bg-black/30': 'bg-black-30',
  'bg-black/50': 'bg-black-50',
  'bg-black/60': 'bg-black-50',
  'bg-black/70': 'bg-black-50',
  'bg-black/75': 'bg-black-50',
  'bg-black/80': 'bg-black-50',
  // 第四批補充（載具、紀錄類）
  'border-emerald-700/60': 'border-status-success-light',
  'border-sky-700/60': 'border-border-theme-light',
  'border-sky-800/60': 'border-border-theme-light',
  'border-amber-600/50': 'border-status-warning-light',
  'border-amber-700/60': 'border-status-warning-light',
  'border-red-800/60': 'border-border-danger-light',
  'border-rose-900': 'border-border-danger-light',
  'bg-rose-950/40': 'bg-status-error-light',
  'border-amber-900/70': 'border-status-warning-light',
  'bg-zinc-800/60': 'bg-surface-secondary',
  'bg-amber-500/5': 'bg-status-warning-light',
  'hover:border-amber-500': 'hover:border-status-warning',
  'bg-black/55': 'bg-black-50',
  'bg-emerald-600': 'bg-status-success-emphasis',
  'bg-[#20252d]': 'bg-surface-secondary',
  'bg-[#15171b]': 'bg-surface-primary',
  'bg-[#080d14]': 'bg-surface-sub-background',
  'bg-[#0f1013]': 'bg-surface-sub-background',
  'border-red-900': 'border-border-danger-light',
  'border-red-900/70': 'border-border-danger-light',
  'bg-red-950/30': 'bg-status-error-light',
  'bg-red-950/85': 'bg-status-error-light',
  'bg-red-500/50': 'bg-status-error-light',
  'hover:bg-white/[0.025]': 'hover:bg-link-standard',
  'bg-emerald-950': 'bg-status-success-light',
  'bg-emerald-500/15': 'bg-status-success-light',
  'bg-zinc-500': 'bg-status-inactive',
  'bg-zinc-500/60': 'bg-status-inactive-light',
  'border-amber-500/70': 'border-status-warning',
  'border-amber-600/60': 'border-status-warning-light',
  'bg-amber-500/20': 'bg-status-warning-light',
  'text-amber-200/90': 'text-status-warning',
  'border-cyan-500/70': 'border-border-theme-light',
  'bg-cyan-500/15': 'bg-surface-theme',
  'focus:border-cyan-500': 'focus:border-border-theme',
  'bg-zinc-900/50': 'bg-surface-primary',
  'text-amber-500/80': 'text-status-warning',
  'border-white/20': 'border-border-tertiary',
  // 第五批補充（中型模組；多為設計色票的 hex 寫法）
  'bg-[#2B7FFF]': 'bg-link-theme-filled',
  'hover:bg-[#2569e6]': 'hover:bg-link-theme-filled-hover',
  'hover:bg-[#256fe6]': 'hover:bg-link-theme-filled-hover',
  'hover:bg-[#1d6feb]': 'hover:bg-link-theme-filled-hover',
  'focus:border-[#2B7FFF]': 'focus:border-border-theme',
  'focus:ring-[#2B7FFF]/30': 'focus:ring-border-theme-light-trn',
  'text-[#51A2FF]': 'text-text-theme',
  'text-[#2B7FFF]': 'text-text-theme-light',
  'border-[#2B7FFF]': 'border-border-theme',
  'hover:text-[#51A2FF]': 'hover:text-text-theme',
  'hover:border-[#2B7FFF]/50': 'hover:border-border-theme-light',
  'focus:border-[#2B7FFF]/60': 'focus:border-border-theme-light',
  'hover:text-[#7CB8FF]': 'hover:text-text-theme',
  'ring-[#2B7FFF]/40': 'ring-border-theme-light',
  'hover:bg-[#2B7FFF]/25': 'hover:bg-link-tonal-hover',
  'border-[#2B7FFF]/50': 'border-border-theme-light',
  'text-[#F3F4F6]': 'text-text-primary',
  'text-[#D1D5DC]': 'text-text-secondary',
  'text-[#6A7282]': 'text-text-quaternary',
  'border-zinc-700/80': 'border-border-quaternary',
  'border-zinc-700/50': 'border-border-quaternary',
  'border-zinc-800/60': 'border-border-quaternary',
  'border-zinc-800/50': 'border-border-quaternary',
  'border-red-900/50': 'border-border-danger-light',
  'border-white/5': 'border-border-disabled',
  'border-white/25': 'border-border-tertiary',
  'bg-[#27272a]': 'bg-surface-secondary',
  'bg-[#29303a]': 'bg-surface-secondary',
  'bg-[#0a0f1a]': 'bg-surface-sub-background',
  'bg-[#0c0c0e]': 'bg-surface-sub-background',
  'bg-[#212124]': 'bg-surface-primary',
  'bg-[#18181b]/95': 'bg-surface-popup',
  'bg-[#18181B]': 'bg-surface-primary',
  'bg-zinc-950/90': 'bg-surface-sub-background',
  'bg-zinc-950/80': 'bg-surface-sub-background',
  'bg-zinc-950/60': 'bg-black-30',
  'bg-zinc-950/40': 'bg-black-30',
  'bg-zinc-950/30': 'bg-black-30',
  'bg-zinc-900/40': 'bg-surface-primary',
  'bg-zinc-800/30': 'bg-link-standard',
  'bg-zinc-700/50': 'bg-link-standard-hover',
  'hover:bg-zinc-800/50': 'hover:bg-link-standard',
  'focus:border-amber-500': 'focus:border-status-warning',
  'border-amber-500': 'border-status-warning',
  'text-amber-500': 'text-status-warning',
  'text-amber-400/90': 'text-status-warning',
  'bg-amber-900/70': 'bg-status-warning-light',
  'bg-red-900': 'bg-status-error-light',
  'bg-rose-500/15': 'bg-status-error-light',
  'bg-emerald-500': 'bg-status-success',
  'border-cyan-500/25': 'border-border-theme-light-trn',
  'bg-cyan-500/5': 'bg-surface-theme-light',
  'border-blue-500/70': 'border-border-theme-light',
  'shadow-black/40': 'shadow-black-30',
  'disabled:text-zinc-700': 'disabled:text-text-disabled',
  // 第六批補充（班表、時間模板）
  'text-[#99A1AF]': 'text-text-tertiary',
  'placeholder:text-[#99A1AF]': 'placeholder:text-text-tertiary',
  'bg-[#232329]': 'bg-surface-secondary',
  'bg-[#1b1b1f]': 'bg-surface-primary',
  'text-[#7CB8FF]': 'text-text-theme',
  'bg-red-500/5': 'bg-status-error-light',
  'bg-[#0c0c0e]/95': 'bg-surface-sub-background',
  'bg-[#0a0a0c]/95': 'bg-surface-sub-background',
  'border-t-zinc-700/90': 'border-t-border-quaternary',
  'border-emerald-500': 'border-status-success',
  'bg-[#2B7FFF]/15': 'bg-surface-theme',
  'text-zinc-700': 'text-text-disabled',
  'focus:ring-[#2B7FFF]': 'focus:ring-border-theme',
  'border-amber-700/40': 'border-status-warning-light',
  'bg-zinc-950/50': 'bg-black-30',
  'text-zinc-950': 'text-text-invert',
  'text-amber-400/80': 'text-status-warning',
  'ring-red-400/60': 'ring-border-danger-light',
  'border-zinc-800/70': 'border-border-quaternary',
  'border-zinc-800/40': 'border-border-quaternary',
  'border-amber-500/50': 'border-status-warning-light',
  'border-amber-400': 'border-status-warning',
  'bg-sky-500/30': 'bg-link-tonal-hover',
  'bg-[#26262b]': 'bg-surface-secondary',
  'text-zinc-300/80': 'text-text-secondary',
  'text-[#5a9aff]': 'text-text-theme',
  'hover:text-[#5a9aff]': 'hover:text-text-theme',
  'ring-[#2B7FFF]/60': 'ring-border-theme-light',
  'hover:border-zinc-400': 'hover:border-border-secondary',
  'hover:bg-black/25': 'hover:bg-black-16',
  'focus:ring-red-500/30': 'focus:ring-status-error-light',
  'border-zinc-800/30': 'border-border-disabled',
  'border-red-500/80': 'border-status-error',
  'border-red-500/40': 'border-border-danger-light',
  'border-emerald-500/20': 'border-status-success-light',
  'border-[#2B7FFF]/60': 'border-border-theme-light',
  'bg-zinc-900/30': 'bg-surface-primary',
  'bg-emerald-500/20': 'bg-status-success-light',
  'bg-[#222225]': 'bg-surface-primary',
  'bg-[#111113]': 'bg-surface-sub-background',
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

/**
 * 色系對應（--families 才啟用）：對照表沒有的 Tailwind 色票，依色系換成語意 token。
 * 藍系→主題色、琥珀／黃／橘→警告、綠系→成功、紅系→錯誤；深色或半透明底→對應的 light 底。
 * 不處理：中性灰的半透明底（畫布上的浮層要透明感）、紫／靛／粉（分類色，沒有語意 token）。
 */
const FAMILY = {
  theme: ['cyan', 'sky', 'blue'],
  warning: ['amber', 'yellow', 'orange'],
  success: ['emerald', 'green', 'teal', 'lime'],
  error: ['red', 'rose'],
};
const familyOf = (hue) => Object.keys(FAMILY).find((key) => FAMILY[key].includes(hue));
const BLACK_STEPS = [5, 10, 16, 30, 50];
const WHITE_STEPS = [40, 50, 80];
export function familyToken(cls) {
  const bw = cls.match(/^(bg|border|text|shadow|ring)-(black|white)\/(\d+)$/);
  if (bw) {
    const steps = bw[2] === 'black' ? BLACK_STEPS : WHITE_STEPS;
    const n = Number(bw[3]);
    return steps.includes(n) ? `${bw[1]}-${bw[2]}-${n}` : null;
  }
  const m = cls.match(/^(text|bg|border|ring|accent|fill|stroke|outline|divide)(?:-([trblxy]))?-([a-z]+)-(\d{2,3})(?:\/(\d+))?$/);
  if (!m) return null;
  const [, kind, side, hue, shadeText, alpha] = m;
  const fam = familyOf(hue);
  if (!fam) return null;
  const shade = Number(shadeText);
  const soft = alpha != null || shade >= 800;
  const pre = side ? `${kind}-${side}` : kind;
  if (kind === 'text' || kind === 'fill' || kind === 'stroke') {
    if (fam === 'theme') return `${kind}-text-${shade <= 300 ? 'theme-light' : 'theme'}`;
    if (fam === 'error') return `${kind}-status-error-emphasis`;
    return `${kind}-status-${fam}`;
  }
  if (kind === 'bg') {
    if (fam === 'theme') return soft ? 'bg-surface-theme' : 'bg-link-theme-filled';
    return soft ? `bg-status-${fam}-light` : `bg-status-${fam}`;
  }
  if (kind === 'border' || kind === 'divide' || kind === 'outline' || kind === 'ring') {
    const base = kind === 'border' && side ? pre : kind;
    if (fam === 'theme') return `${base}-border-${soft ? 'theme-light' : 'theme'}`;
    if (fam === 'error') return soft ? `${base}-border-danger-light` : `${base}-status-error`;
    return `${base}-status-${fam}${soft ? '-light' : ''}`;
  }
  if (kind === 'accent') return fam === 'theme' ? 'accent-link-theme-filled' : null;
  return null;
}

/**
 * 寫死色值 → 語意 token（--families 才啟用）。只收設計稿裡有對應的值；
 * 自訂深色底（#151516、#252b34…）、分類色不在這裡。key 是去掉空白的色值，value 依 class 種類給 token。
 */
const ARBITRARY = {
  'rgba(212,212,212,0.15)': { border: 'border-quaternary', divide: 'border-quaternary', bg: 'surface-secondary' },
  'rgba(212,212,212,0.1)': { border: 'border-quaternary', bg: 'surface-secondary' },
  'rgba(212,212,212,0.25)': { border: 'border-tertiary' },
  'rgba(212,212,216,0.1)': { bg: 'surface-secondary', border: 'border-quaternary' },
  'rgba(209,213,220,0.08)': { bg: 'link-standard' },
  'rgba(209,213,220,0.12)': { bg: 'link-standard' },
  'rgba(142,197,255,0.08)': { bg: 'surface-theme' },
  'rgba(142,197,255,0.04)': { bg: 'surface-theme-light' },
  'rgba(81,162,255,0.24)': { bg: 'link-tonal' },
  'rgba(81,162,255,0.32)': { bg: 'link-tonal-hover' },
  'rgba(81,162,255,0.5)': { border: 'border-theme-light' },
  'rgba(43,127,255,0.2)': { bg: 'link-tonal' },
  'rgba(43,127,255,0.12)': { bg: 'link-tonal' },
  'rgba(43,127,255,0.24)': { bg: 'link-tonal' },
  'rgba(0,212,146,0.2)': { bg: 'status-success-light' },
  'rgba(239,68,68,0.2)': { bg: 'status-error-light' },
  'rgba(251,146,60,0.2)': { bg: 'status-warning-light' },
  '#2b7fff': { bg: 'link-theme-filled', border: 'link-theme-filled', ring: 'link-theme-filled', text: 'text-theme-light' },
  '#51a2ff': { ring: 'border-theme', border: 'border-theme', text: 'text-theme', bg: 'link-theme-filled-hover' },
  '#7cb8ff': { border: 'border-theme' },
  '#00d492': { bg: 'status-success', text: 'status-success' },
  '#ef4444': { bg: 'status-error', text: 'status-error-emphasis' },
  '#fb923c': { bg: 'status-warning', text: 'status-warning' },
  '#9ca3af': { text: 'text-tertiary' },
  '#99a1af': { text: 'text-tertiary' },
  '#27272a': { border: 'border-quaternary' },
  '#1f1f23': { bg: 'surface-primary' },
};
export function arbitraryToken(cls) {
  const m = cls.match(/^(bg|text|border|ring|divide)(-[trblxy])?-\[([^\]]+)\](\/\d+)?$/);
  if (!m) return null;
  const [, kind, side = '', raw, alpha = ''] = m;
  const entry = ARBITRARY[raw.replace(/\s+/g, '').toLowerCase()];
  const token = entry?.[kind];
  return token ? `${kind}${side}-${token}${alpha}` : null;
}

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\/#]/g, '\\$&');
// 前面不能是 class 字元（避免吃到 hover:text-zinc-100 以外的長名稱），後面不能接 class 字元或 /透明度
const PATTERNS = Object.entries(CLASS_MAP)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([from, to]) => [new RegExp(`(?<![\\w\\-\\[#/:])${escape(from)}(?![\\w\\-/\\]])`, 'g'), to, from]);

export function migrate(text, { families = false } = {}) {
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
  // 設計字級＋另加字重：body 字級改用 -bold，標題類拿掉多的字重；字距、行高由字級決定
  out = out.replace(/(['"`])((?:(?!\1)[^\n])*?)\1/g, (whole, quote, body) => {
    const size = body.match(/(?<![\w:-])text-(body-(?:l|m|s|xs)|headline-[1-5]|display-[lsm]|caption-[123])(-bold)?(?![\w-])/);
    if (!size) return whole;
    let next = body;
    if (/(?<![\w:-])font-(?:medium|semibold|bold)(?![\w-])/.test(next)) {
      next = next.replace(/\s*(?<![\w:-])font-(?:medium|semibold|bold)(?![\w-])/g, '');
      if (size[1].startsWith('body-') && !size[2]) next = next.replace(size[0], `${size[0]}-bold`);
    }
    next = next.replace(/\s*(?<![\w:-])(?:tracking-(?:tight|tighter|wide|wider|widest|normal)|leading-(?:\d+|tight|snug|normal|relaxed|none))(?![\w-])/g, '');
    if (next !== body) hits['字重／字距整理'] = (hits['字重／字距整理'] ?? 0) + 1;
    return `${quote}${next.trimStart() === next ? next : next.trimStart()}${quote}`;
  });
  if (families) {
    out = out.replace(/(?<![\w\-[#/:])((?:[a-z0-9-]+:)*)((?:bg|text|border|ring|divide)(?:-[trblxy])?-\[[^\]\s'"`]+\](?:\/\d+)?)/g, (whole, prefix, cls) => {
      const token = arbitraryToken(cls);
      if (!token) return whole;
      hits[`${prefix}${cls}`] = (hits[`${prefix}${cls}`] ?? 0) + 1;
      return `${prefix}${token}`;
    });
    out = out.replace(/(?<![\w\-[#/:])((?:[a-z0-9-]+:)*)((?:text|bg|border|ring|accent|fill|stroke|outline|divide|shadow)(?:-[trblxy])?-[a-z]+(?:-\d{2,3})?(?:\/\d+)?)(?![\w\-/\]])/g, (whole, prefix, cls) => {
      const token = familyToken(cls);
      if (!token) return whole;
      hits[`${prefix}${cls}`] = (hits[`${prefix}${cls}`] ?? 0) + 1;
      return `${prefix}${token}`;
    });
  }
  return { text: out, hits };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const families = args.includes('--families');
  for (const file of args.filter((arg) => !arg.startsWith('--'))) {
    const before = readFileSync(file, 'utf8');
    const { text, hits } = migrate(before, { families });
    const total = Object.values(hits).reduce((a, b) => a + b, 0);
    if (!dry && text !== before) writeFileSync(file, text);
    console.log(`${file}: ${total} 處${total ? `（${Object.entries(hits).map(([k, v]) => `${k}×${v}`).join('、')}）` : ''}`);
  }
}
