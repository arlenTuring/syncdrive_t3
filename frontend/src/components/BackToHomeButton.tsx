import { ArrowLeft } from 'lucide-react'
import { Button } from './ui'

type BackToHomeButtonProps = {
  onClick: () => void
  className?: string
}

/** 從各圖台返回首頁（模式選擇） */
export function BackToHomeButton({ onClick, className }: BackToHomeButtonProps) {
  return (
    <Button
      hierarchy="subordinate"
      variant="outlined"
      leadingIcon={<ArrowLeft />}
      onPress={onClick}
      title="返回首頁"
      aria-label="返回首頁"
      className={className}
    >
      首頁
    </Button>
  )
}
