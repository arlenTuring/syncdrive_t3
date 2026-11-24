import type { ReactNode } from 'react';
import { Header } from '../../../components/ui';
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
        {/* Header 規格 Web-Header：高 40、標題 18/24/500、左側 Icon 24（上下各留 8，整列 56 跟以前一樣） */}
        <header className="shrink-0 border-b border-border-quaternary px-3 py-2">
          <Header
            type="web"
            as="h1"
            icon={titleIcon}
            title={title}
            actions={<ShellAccountToolbar onOpenSystemFoundation={onOpenSystemFoundation} />}
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
