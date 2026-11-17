import { FileAudio, FileImage, FileText, FileVideo } from 'lucide-react';
import { Checkbox as UiCheckbox, Pagination as UiPagination } from '../../components/ui';
import type { MediaType } from '../media-content/api';

const TYPE_LABEL: Record<MediaType, string> = { audio: '音檔', text: '文字', image: '圖片', video: '影片' };

export function TypeBadge({ type }: { type: MediaType | null }) {
  const Icon = type === 'audio' ? FileAudio : type === 'image' ? FileImage : type === 'video' ? FileVideo : FileText;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-link-standard-hover px-3 py-1 text-body-s text-text-primary">
      <Icon className="size-4" aria-hidden />
      {type ? TYPE_LABEL[type] : '未設定'}
    </span>
  );
}

/**
 * 媒體頁的勾選框＝系統 Checkbox（保留舊的參數：onChange 不帶值、indeterminate 表示部分勾選）。
 * 新程式直接用 components/ui 的 Checkbox。
 */
export function Checkbox({ checked, disabled, onChange, label, indeterminate = false }: { checked: boolean; disabled?: boolean; onChange: () => void; label: string; indeterminate?: boolean }) {
  return <UiCheckbox checked={indeterminate && !checked ? 'mixed' : checked} disabled={disabled} aria-label={label} onCheckedChange={() => onChange()} />;
}

/** 數字頁碼＝系統 Pagination（保留舊名稱，新程式直接用 components/ui 的 Pagination） */
export function Pagination(props: { page: number; total: number; pageSize: number; onChange: (page: number) => void }) {
  return <UiPagination className="pt-5" {...props} />;
}
