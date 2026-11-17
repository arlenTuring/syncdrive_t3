import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';
import { surfaceClass, type SurfaceLevel } from '../variants';

/** 面板（卡片）：底色依層級取 surface token；padding 預設 p-4 */
export function Panel({
  level = 'primary',
  bordered = true,
  padded = true,
  title,
  actions,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  level?: SurfaceLevel;
  bordered?: boolean;
  padded?: boolean;
  title?: ReactNode;
  /** 標題列右側（按鈕等） */
  actions?: ReactNode;
}) {
  return (
    <div className={cn('rounded-xl', surfaceClass(level, { bordered }), padded && 'p-4', className)} {...rest}>
      {title || actions ? (
        <div className="mb-3 flex items-center gap-3">
          {title ? <h3 className="min-w-0 flex-1 truncate text-headline-5 text-text-primary">{title}</h3> : <span className="flex-1" />}
          {actions}
        </div>
      ) : null}
      {children}
    </div>
  );
}
