import type { ReactNode } from 'react';
import { ShellAccountToolbar } from './ShellAccountToolbar';

type ShellWorkspaceFrameProps = {
  title: string;
  titleIcon?: ReactNode;
  children: ReactNode;
  /** 地圖／全螢幕編輯器可不套圓角卡片內距 */
  flush?: boolean;
  onOpenSystemFoundation: () => void;
};

/**
 * VTMS 內容區外框：頂欄標題 + 右上角帳戶工具列。
 */
export function ShellWorkspaceFrame({
  title,
  titleIcon,
  children,
  flush = false,
  onOpenSystemFoundation,
}: ShellWorkspaceFrameProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-primary p-3">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border-quaternary bg-surface-sub-background ring-1 ring-black-30">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border-quaternary px-5">
          <div className="flex min-w-0 items-center gap-2.5 text-text-primary">
            {titleIcon}
            <h1 className="truncate text-body-m-bold">{title}</h1>
          </div>
          <ShellAccountToolbar
            onOpenSystemFoundation={onOpenSystemFoundation}
          />
        </header>
        <div
          className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
            flush ? '' : ''
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
