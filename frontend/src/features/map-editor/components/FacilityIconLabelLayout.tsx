import type { ReactNode } from 'react'

type Props = {
  icon: ReactNode
  className?: string
}

/** 圖示置中容器（名稱由 FacilityDraggableLabel 繪於設施根層，避免被工具列遮住） */
export function FacilityIconLabelLayout({ icon, className = '' }: Props) {
  return (
    <div
      className={`relative flex min-h-0 min-w-0 flex-1 items-center justify-center ${className}`}
    >
      {icon}
    </div>
  )
}
