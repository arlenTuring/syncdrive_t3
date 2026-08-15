import type { ReactNode } from 'react';
import { ShellAccountToolbar } from './ShellAccountToolbar';

type ShellWorkspaceFrameProps = {
  title: string;
  titleIcon?: ReactNode;
  children: ReactNode;
  /** 地圖／全螢幕編輯器可不套圓角卡片內距 */
  flush?: boolean;
  adminMode: boolean;
  onAdminModeChange: (enabled: boolean) => void;
};

/**
 * VTMS 內容區外框：頂欄標題 + 右上角帳戶工具列。
 */
export function ShellWorkspaceFrame({
  title,
  titleIcon,
  children,
  flush = false,
  adminMode,
  onAdminModeChange,
}: ShellWorkspaceFrameProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#121214] p-3">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800/90 bg-[#0a0a0b] shadow-[0_0_0_1px_rgba(0,0,0,0.4)]">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-zinc-800/90 px-5">
          <div className="flex min-w-0 items-center gap-2.5 text-zinc-100">
            {titleIcon}
            <h1 className="truncate text-[15px] font-semibold tracking-tight">{title}</h1>
          </div>
          <ShellAccountToolbar
            adminMode={adminMode}
            onAdminModeChange={onAdminModeChange}
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
