import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '../button/Button';
import { cn } from '../cn';

/**
 * 數字頁碼：‹ 1 2 3 … ›，目前頁外框高亮（專案自訂，設計稿尚未提供規格；規格到了只改這裡）。
 * 最多顯示 7 個頁碼，目前頁盡量置中。
 */
export function Pagination({
  page,
  total,
  pageSize,
  onChange,
  className,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = Math.max(1, Math.min(page - 3, pages - 6));
  const numbers = Array.from({ length: Math.min(7, pages) }, (_, index) => start + index);
  return (
    <nav aria-label="分頁" className={cn('flex items-center justify-center gap-1', className)}>
      <IconButton label="上一頁" size="small" hierarchy="subordinate" variant="standard" icon={<ChevronLeft />} disabled={page <= 1} onPress={() => onChange(page - 1)} />
      {numbers.map((number) => (
        <button
          key={number}
          type="button"
          onClick={() => onChange(number)}
          aria-current={number === page ? 'page' : undefined}
          aria-label={`第 ${number} 頁`}
          className={cn(
            'h-[34px] min-w-[34px] rounded-lg px-2 text-body-m tabular-nums transition-colors',
            number === page ? 'text-text-theme ring-1 ring-inset ring-border-theme' : 'text-text-primary hover:bg-link-standard',
          )}
        >
          {number}
        </button>
      ))}
      <IconButton label="下一頁" size="small" hierarchy="subordinate" variant="standard" icon={<ChevronRight />} disabled={page >= pages} onPress={() => onChange(page + 1)} />
    </nav>
  );
}
