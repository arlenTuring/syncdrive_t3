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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-sub-background p-3">
      {/* 設計稿：外圍是黑底（surface-sub-background），內容卡片是 surface-background，頂欄與內容之間不畫分隔線 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-surface-background">
        {/* Header 規格 Web-Header：高 40、標題 18/24/500、左側 Icon 24、標題與 Icon 都是 text-primary */}
        <header className="shrink-0 px-3 pb-2 pt-3">
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
