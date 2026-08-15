import { Bell, ChevronDown, Settings, User, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

type ShellAccountToolbarProps = {
  /** 通知未讀數；沒給就顯示參考圖的 1 */
  notificationCount?: number;
  userName?: string;
  adminMode: boolean;
  onAdminModeChange: (enabled: boolean) => void;
};

export function ShellAccountToolbar({
  notificationCount = 1,
  userName = 'Leo',
  adminMode,
  onAdminModeChange,
}: ShellAccountToolbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [settingsOpen]);

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      <button
        type="button"
        className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg bg-[#1f1f22] px-2.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
        title="語言"
        aria-label="Language EN"
      >
        EN
      </button>

      <span className="h-4 w-px bg-zinc-700/80" aria-hidden />

      <button
        type="button"
        className="relative inline-flex size-8 items-center justify-center rounded-full bg-[#1f1f22] text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
        title="通知"
        aria-label={`通知 ${notificationCount} 則`}
      >
        <Bell className="size-4" />
        {notificationCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {notificationCount > 99 ? '99+' : notificationCount}
          </span>
        ) : null}
      </button>

      <span className="h-4 w-px bg-zinc-700/80" aria-hidden />

      <button
        type="button"
        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#1f1f22] pl-2 pr-2.5 text-sm text-zinc-200 transition hover:bg-zinc-800 hover:text-white"
        title="帳戶"
        aria-label={`帳戶 ${userName}`}
      >
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-zinc-800 text-zinc-300">
          <User className="size-3.5" />
        </span>
        <span className="max-w-[7rem] truncate font-medium">{userName}</span>
        <ChevronDown className="size-3.5 text-zinc-500" />
      </button>

      <span className="h-4 w-px bg-zinc-700/80" aria-hidden />

      <button
        type="button"
        onClick={() => setSettingsOpen((open) => !open)}
        className={`inline-flex size-8 items-center justify-center rounded-full transition ${
          settingsOpen
            ? 'bg-sky-600/25 text-sky-300'
            : 'bg-[#1f1f22] text-zinc-300 hover:bg-zinc-800 hover:text-white'
        }`}
        title="設定"
        aria-label="設定"
        aria-expanded={settingsOpen}
        aria-controls={panelId}
      >
        <Settings className="size-4" />
      </button>

      {settingsOpen ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="設定"
          className="absolute right-0 top-[calc(100%+10px)] z-50 w-72 overflow-hidden rounded-xl border border-zinc-700/90 bg-[#141416] shadow-2xl shadow-black/50"
        >
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-100">設定</h2>
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="關閉"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="px-4 py-4">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-100">切換成管理員</div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  開啟後可使用管理相關操作
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={adminMode}
                onClick={() => onAdminModeChange(!adminMode)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                  adminMode ? 'bg-sky-500' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition ${
                    adminMode ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}
