import { ArrowLeft } from 'lucide-react'
import { cn } from './ui'

type BackToHomeButtonProps = {
  onClick: () => void
  className?: string
}

/** 從各圖台返回首頁（模式選擇） */
export function BackToHomeButton({ onClick, className = '' }: BackToHomeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="返回首頁"
      aria-label="返回首頁"
      className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-tertiary bg-surface-primary px-2 py-1 text-body-xs text-text-secondary transition hover:bg-link-standard-hover hover:text-text-primary sm:px-2.5 sm:py-1.5 sm:text-body-s', className)}
    >
      <ArrowLeft className="size-3.5 shrink-0 sm:size-4" aria-hidden />
      <span className="hidden sm:inline">首頁</span>
    </button>
  )
}
