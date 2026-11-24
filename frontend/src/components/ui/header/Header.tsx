import type { ReactNode } from 'react';
import { cn } from '../cn';

/**
 * 頁首／標題列（design-specs/t3-header-engineering-spec.md；樣式在 header.css，逐字取自規格 §7）。
 *
 * type：web（全站頂欄，高 40、標題 18/24/500）、subheader（34）、title（20、16/20/500）、
 * edit（Title-EditName）、subtitle（34、16/20/400）、label（14/18）。
 * 標題過長單行省略、完整文字放 title 屬性；操作區不會被壓縮。
 * 右側內容（按鈕、語言、通知、使用者）由呼叫端放進 actions，用 HeaderIconButton／HeaderAvatar 等規格零件。
 */

export type HeaderType = 'web' | 'subheader' | 'title' | 'edit' | 'subtitle' | 'label';

export function Header({
  type = 'title',
  icon,
  title,
  titleAfter,
  actions,
  as: Heading = 'h2',
  className,
}: {
  type?: HeaderType;
  /** 左側 Icon（web／subheader 24px、title 類 20px、label 16px） */
  icon?: ReactNode;
  title: string;
  /** 緊接標題後面的小元件（資訊 Icon、更新時間、自動儲存、標籤） */
  titleAfter?: ReactNode;
  actions?: ReactNode;
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
}) {
  return (
    <div className={cn('t3-header', `t3-header--${type}`, className)}>
      <div className="t3-header__title">
        {icon ? <span className="t3-header__home" aria-hidden>{icon}</span> : null}
        <span className="t3-header__heading-group">
          <Heading className="t3-header__heading" title={title}>{title}</Heading>
          {titleAfter}
        </span>
      </div>
      {actions ? <div className="t3-header__actions">{actions}</div> : null}
    </div>
  );
}

/** 頂欄的 34×34 圖示按鈕（圖示 24）；settings＝設定鈕（底色 link-standard） */
export function HeaderIconButton({
  label,
  icon,
  onPress,
  settings = false,
  pressed,
}: {
  label: string;
  icon: ReactNode;
  onPress?: () => void;
  settings?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn('t3-header__icon-button', settings && 't3-header__settings')}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onPress}
    >
      {icon}
    </button>
  );
}

/** 頂欄 40×40 圓形頭像按鈕（通知、使用者）；badge＝通知數 */
export function HeaderAvatar({ label, icon, badge, onPress }: { label: string; icon: ReactNode; badge?: ReactNode; onPress?: () => void }) {
  return (
    <button type="button" className="t3-header__avatar" aria-label={label} title={label} onClick={onPress}>
      {icon}
      {badge != null ? <span className="t3-header__badge">{badge}</span> : null}
    </button>
  );
}

export function HeaderDivider() {
  return <span className="t3-header__divider" aria-hidden />;
}
