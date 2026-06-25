import { ArrowLeft } from 'lucide-react'

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
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-900/90 px-2 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100 sm:px-2.5 sm:py-1.5 sm:text-sm ${className}`}
    >
      <ArrowLeft className="size-3.5 shrink-0 sm:size-4" aria-hidden />
      <span className="hidden sm:inline">首頁</span>
    </button>
  )
}
