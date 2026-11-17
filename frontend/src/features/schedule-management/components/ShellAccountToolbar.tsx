import {
  Bell,
  ChevronDown,
  LogOut,
  Settings,
  User,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isAppLocale,
  localeToolbarCode,
  nextAppLocale,
  writeUserLocaleOverride,
  type AppLocale,
} from '../../../i18n/localePreference';
import { useAuth } from '../../access-control/AuthContext';
import { Button, IconButton } from '../../../components/ui';

type ShellAccountToolbarProps = {
  notificationCount?: number;
  onOpenSystemFoundation: () => void;
};

export function ShellAccountToolbar({
  notificationCount = 0,
  onOpenSystemFoundation,
}: ShellAccountToolbarProps) {
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const currentLocale: AppLocale = isAppLocale(i18n.language)
    ? i18n.language
    : 'zh-TW';

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [settingsOpen]);

  const cycleLocale = () => {
    const next = nextAppLocale(currentLocale);
    writeUserLocaleOverride(next);
    void i18n.changeLanguage(next);
  };

  return (
    <>
      <div ref={rootRef} className="relative flex items-center gap-2">
        <Button hierarchy="subordinate" variant="tonal" className="min-w-8" onPress={cycleLocale} title={t('shell.language')} aria-label={t('shell.language')}>{localeToolbarCode(currentLocale)}</Button>
        <span className="h-4 w-px bg-border-tertiary" aria-hidden />
        <button
          type="button"
          className="relative inline-flex size-8 items-center justify-center rounded-full bg-surface-secondary text-text-secondary transition hover:bg-link-standard-hover hover:text-text-primary"
          title={t('shell.notifications')}
          aria-label={t('shell.notificationsCount', { count: notificationCount })}
        >
          <Bell className="size-4" />
          {notificationCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-error px-1 text-caption-2 text-text-primary">
              {notificationCount > 99 ? '99+' : notificationCount}
            </span>
          ) : null}
        </button>
        <span className="h-4 w-px bg-border-tertiary" aria-hidden />
        <button
          type="button"
          onClick={() => setSettingsOpen((open) => !open)}
          aria-expanded={settingsOpen}
          aria-controls={panelId}
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-secondary pl-2 pr-2.5 text-body-s text-text-primary transition hover:bg-link-standard-hover hover:text-text-primary"
          aria-label={auth.user ? `登入帳號 ${auth.user.display_name}` : '登入'}
        >
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-surface-secondary text-text-secondary">
            <User className="size-3.5" />
          </span>
          <span className="max-w-[7rem] truncate font-medium">
            {auth.loading ? '讀取中…' : auth.user?.display_name ?? '登入'}
          </span>
          <ChevronDown className="size-3.5 text-text-quaternary" />
        </button>
        {/* 沒有系統基礎模組權限的帳號（例如廠商）看不到齒輪，不是點了才說權限不足 */}
        {auth.can('system.health.view') ? (
        <>
        <span className="h-4 w-px bg-border-tertiary" aria-hidden />
        <IconButton size="small" hierarchy="subordinate" variant="tonal" onPress={() => {
      setSettingsOpen(false);
      onOpenSystemFoundation();
     }} title={t('shell.settings')} label={t('shell.settings')} icon={<Settings />} />
        </>
        ) : null}

        {settingsOpen && auth.user ? (
          <div id={panelId} role="dialog" aria-label="帳號資訊" className="absolute right-0 top-[calc(100%+10px)] z-50 w-80 overflow-hidden rounded-xl border border-border-quaternary bg-surface-popup shadow-2xl shadow-black-50">
            <div className="flex items-center justify-between border-b border-border-quaternary px-4 py-3">
              <h2 className="text-body-s-bold text-text-primary">帳號資訊</h2>
              <IconButton size="small" hierarchy="subordinate" variant="standard" label="關閉" icon={<X />} onPress={() => setSettingsOpen(false)} />
            </div>
            <div className="space-y-4 px-4 py-4">
              <div className="rounded-xl bg-surface-primary p-3">
                <div className="font-medium text-text-primary">{auth.user.display_name}</div>
                <div className="text-body-s text-text-quaternary">{auth.user.account_name}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {auth.user.roles.map((role) => <span key={role.id} className="rounded bg-link-standard-hover px-2 py-0.5 text-body-xs">{role.name}</span>)}
                </div>
              </div>
              <Button hierarchy="subordinate" variant="outlined" block leadingIcon={<LogOut />} onPress={() => { setSettingsOpen(false); void auth.logout(); }}>
                登出
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
