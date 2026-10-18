import { Check, ChevronLeft, ChevronRight, FileAudio, FileImage, FileText, FileVideo, Minus } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { MediaType } from '../media-content/api';

const TYPE_LABEL: Record<MediaType, string> = { audio: '音檔', text: '文字', image: '圖片', video: '影片' };

export function TypeBadge({ type }: { type: MediaType | null }) {
  const Icon = type === 'audio' ? FileAudio : type === 'image' ? FileImage : type === 'video' ? FileVideo : FileText;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-700 px-3 py-1 text-zinc-100">
      <Icon className="size-4" aria-hidden />
      {type ? TYPE_LABEL[type] : '未設定'}
    </span>
  );
}

/** 深色方框勾選（原生 input 保留給鍵盤與輔助技術，外觀自己畫）；支援部分選取狀態 */
export function Checkbox({ checked, disabled, onChange, label, indeterminate = false }: { checked: boolean; disabled?: boolean; onChange: () => void; label: string; indeterminate?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className={`relative inline-flex size-7 items-center justify-center ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}>
      <input ref={inputRef} type="checkbox" checked={checked} disabled={disabled} onChange={onChange} aria-label={label} className="peer absolute inset-0 cursor-[inherit] opacity-0" />
      <span className={`flex size-7 items-center justify-center rounded-md border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 ${checked || indeterminate ? 'border-blue-500 bg-blue-600' : 'border-zinc-500'}`} aria-hidden>
        {checked ? <Check className="size-5 text-white" /> : indeterminate ? <Minus className="size-5 text-white" /> : null}
      </span>
    </label>
  );
}

/** 數字頁碼（依設計稿：‹ 1 2 3 ›，目前頁外框高亮） */
export function Pagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = Math.max(1, Math.min(page - 3, pages - 6));
  const numbers = Array.from({ length: Math.min(7, pages) }, (_, index) => start + index);
  return (
    <nav aria-label="分頁" className="flex items-center justify-center gap-3 pt-5 text-lg">
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="上一頁" className="rounded-lg p-1 disabled:opacity-30">
        <ChevronLeft className="size-5" />
      </button>
      {numbers.map((number) => (
        <button
          key={number}
          type="button"
          onClick={() => onChange(number)}
          aria-current={number === page ? 'page' : undefined}
          aria-label={`第 ${number} 頁`}
          className={`min-w-9 rounded-lg px-2 py-0.5 ${number === page ? 'border border-blue-500 text-blue-400' : 'text-zinc-200 hover:bg-white/5'}`}
        >
          {number}
        </button>
      ))}
      <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="下一頁" className="rounded-lg p-1 disabled:opacity-30">
        <ChevronRight className="size-5" />
      </button>
    </nav>
  );
}
