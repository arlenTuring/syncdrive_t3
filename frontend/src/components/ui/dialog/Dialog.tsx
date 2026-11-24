import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from '../button/Button';
import { DialogCloseIcon, DialogErrorIcon, DialogInfoIcon, DialogSuccessIcon, DialogWarningIcon } from './DialogIcons';
import { cn } from '../cn';
import { DIALOG_OVERLAY_CLASS, DIALOG_PANEL_CLASS, DIALOG_WIDTHS, type DialogSize } from '../variants';

/** 開著的對話框（後開的在最後）：只有最上層處理 Escape，子對話框不會連帶關掉主對話框 */
const openDialogs: symbol[] = [];

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Basic Usage（Dialog_Event）的四種提示：主圖示與按鈕組合照 Dialog 工程規範 */
export type DialogTone = 'info' | 'success' | 'error' | 'warning';

const TONE_ICON: Record<DialogTone, ReactNode> = {
  info: <DialogInfoIcon className="text-text-tertiary" />,
  success: <DialogSuccessIcon className="text-status-success" />,
  error: <DialogErrorIcon className="text-status-error" />,
  warning: <DialogWarningIcon className="text-status-warning-emphasis" />,
};

export type DialogProps = {
  title: ReactNode;
  /** 標題上方的圖示（例如警告） */
  icon?: ReactNode;
  /** 標題下方的說明 */
  description?: ReactNode;
  onClose: () => void;
  /** 底部按鈕列（靠右排列） */
  footer?: ReactNode;
  size?: DialogSize;
  /** 處理中：不能關閉（Escape、點背景、右上角 X 都停用） */
  busy?: boolean;
  /** 點背景是否關閉；預設會 */
  closeOnBackdrop?: boolean;
  /** 隱藏右上角 X */
  hideClose?: boolean;
  /**
   * 不顯示系統標題列（標題只給螢幕閱讀器），由 children 自己排標題與關閉鈕。
   * 給還沒整理內部版面的舊對話框過渡用：外框、遮罩、焦點、Escape 已經是系統的。
   */
  headerless?: boolean;
  /** 疊在其他對話框之上時用較高的層級 */
  layer?: 'dialog' | 'system';
  /** 開啟時要聚焦的元素；不給就聚焦第一個可操作元件 */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  role?: 'dialog' | 'alertdialog';
  children?: ReactNode;
  /** 只用來調整內容區排版（例如 gap） */
  bodyClassName?: string;
  /** false＝內容區不加內距、不捲動，由 children 自己排版（例如內容自帶分欄與底部列） */
  padded?: boolean;
  /** 寬度：預設依 size；要特殊寬度時給 max-w-* class（只放寬度）。給 w-* 時以它為準，不再撐滿 */
  widthClassName?: string;
  /** 固定高度等尺寸 class（例如 h-[min(820px,92vh)]）；只放尺寸，不放顏色 */
  heightClassName?: string;
  /** 給了就把內容與底部按鈕包成一個 <form>：底部的 type="submit" 按鈕直接送出 */
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  /**
   * 給了就是提示型（Basic Usage｜Dialog_Event）：寬 360、主圖示＋標題＋內文，只有內文捲動。
   * 不給是一般容器（Overlay｜Dialog_Container）。
   */
  tone?: DialogTone;
};

/** 提示型對話框的取消／確定按鈕：Error 用 Subordinate／Danger，其他用 Superior（Dialog 工程規範「各類型的操作元件」） */
export function DialogEventActions({
  tone,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  confirmRef,
}: {
  tone: DialogTone;
  cancelLabel?: ReactNode;
  confirmLabel: ReactNode;
  onCancel?: () => void;
  onConfirm: () => void;
  confirmRef?: React.Ref<HTMLButtonElement>;
}) {
  const error = tone === 'error';
  return (
    <>
      {onCancel ? (
        <Button hierarchy={error ? 'subordinate' : 'superior'} variant="standard" onClick={onCancel}>
          {cancelLabel}
        </Button>
      ) : null}
      <Button
        ref={confirmRef}
        hierarchy={error ? 'danger' : 'superior'}
        variant="filled"
        onClick={onConfirm}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onConfirm();
          }
        }}
      >
        {confirmLabel}
      </Button>
    </>
  );
}

/**
 * 系統對話框：遮罩、外框、標題列、內容、底部按鈕列。焦點鎖在框內，關閉後還原。
 * 所有對話框都用它，不要再各自寫 fixed inset-0 的外框。
 */
export function Dialog({
  title,
  icon,
  description,
  onClose,
  footer,
  size = 'md',
  busy = false,
  closeOnBackdrop = true,
  hideClose = false,
  headerless = false,
  layer = 'dialog',
  initialFocusRef,
  role = 'dialog',
  children,
  bodyClassName,
  padded = true,
  widthClassName,
  heightClassName,
  onSubmit,
  tone,
}: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  });

  useEffect(() => {
    previous.current = document.activeElement as HTMLElement | null;
    const target = initialFocusRef?.current
      ?? panel.current?.querySelector<HTMLElement>('[data-autofocus]')
      ?? panel.current?.querySelector('[data-dialog-body]')?.querySelector<HTMLElement>(FOCUSABLE)
      ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    const self = Symbol('dialog');
    openDialogs.push(self);
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || openDialogs[openDialogs.length - 1] !== self) return;
      // 日期時間、下拉等浮動面板開著時，Escape 先交給它關閉
      if (document.querySelector('[data-anchored-popover]')) return;
      // 拿起中的拖曳項目等自己處理 Escape（取消移動），不關閉對話框
      if ((document.activeElement as HTMLElement | null)?.closest?.('[data-captures-escape="true"]')) return;
      event.stopPropagation();
      if (!busyRef.current) closeRef.current();
    };
    window.addEventListener('keydown', onEscape, true);
    return () => {
      window.removeEventListener('keydown', onEscape, true);
      openDialogs.splice(openDialogs.indexOf(self), 1);
      if (previous.current?.isConnected) previous.current.focus();
    };
    // 只在開啟時聚焦一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const closeButton = hideClose ? null : (
    <IconButton label="關閉" icon={<DialogCloseIcon />} hierarchy="subordinate" variant="standard" onClick={onClose} disabled={busy} />
  );
  const actions = footer ? <footer className="t3-dialog-actions">{footer}</footer> : null;

  const content = tone ? (
    <>
      <div className="t3-dialog-event-content">
        <div className="t3-dialog-event-header">
          {icon ?? TONE_ICON[tone]}
          <h2 id={titleId} className="text-body-m-bold text-text-primary">{title}</h2>
        </div>
        <div data-dialog-body className={cn('t3-dialog-copy-wrap text-body-s text-text-tertiary', bodyClassName)}>
          {description ? <p id={descriptionId}>{description}</p> : null}
          {children}
        </div>
      </div>
      {closeButton ? <div className="t3-dialog-event-close">{closeButton}</div> : null}
      {actions}
    </>
  ) : (
    <>
      <div
        data-dialog-body
        className={padded
          ? cn('t3-dialog-content text-body-s text-text-secondary', bodyClassName)
          : cn('flex min-h-0 flex-1 flex-col', bodyClassName)}
      >
        {children}
      </div>
      {actions}
    </>
  );

  return createPortal(
    <div
      className={cn(DIALOG_OVERLAY_CLASS, layer === 'system' ? 'z-[1000]' : 'z-[230]')}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && closeOnBackdrop && !busy) onClose();
      }}
    >
      <div
        ref={panel}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onKeyDown={onKeyDown}
        className={cn(
          DIALOG_PANEL_CLASS,
          tone
            ? 't3-dialog-event'
            : cn(
              !headerless && 't3-dialog-container',
              // 呼叫端自己給 w-* 時不再加 w-full（兩個寬度 class 會互相覆蓋，誰贏看 CSS 順序）
              /(^|\s)w-/.test(widthClassName ?? '') ? null : 'w-full',
              widthClassName ?? DIALOG_WIDTHS[size],
            ),
          heightClassName,
        )}
      >
        {tone ? null : headerless ? (
          <h2 id={titleId} className="sr-only">{title}</h2>
        ) : (
          <>
            <header className="t3-dialog-header">
              {icon}
              <h2 id={titleId} className="min-w-0 flex-1 text-body-m-bold text-text-primary">{title}</h2>
              {closeButton}
            </header>
            {description ? <p id={descriptionId} className="px-5 pt-1 text-body-s text-text-tertiary">{description}</p> : null}
          </>
        )}
        {onSubmit ? (
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
            {content}
          </form>
        ) : (
          content
        )}
      </div>
    </div>,
    document.body,
  );
}
