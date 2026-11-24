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
import { Button, HeaderAvatar, HeaderDivider, HeaderIconButton, IconButton } from '../../../components/ui';

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
      {/* Header 規格 Web-Header 右側：語言、通知、使用者、設定，間距 16、分隔線 1×20 */}
      <div ref={rootRef} className="t3-header__actions relative gap-4">
        <button type="button" className="t3-header__button t3-header__button--standard" onClick={cycleLocale} title={t('shell.language')} aria-label={t('shell.language')}>{localeToolbarCode(currentLocale)}</button>
        <HeaderDivider />
        <HeaderAvatar
          label={t('shell.notificationsCount', { count: notificationCount })}
          icon={<Bell />}
          badge={notificationCount > 0 ? (notificationCount > 99 ? '99+' : notificationCount) : undefined}
        />
        <HeaderDivider />
        <button
          type="button"
          onClick={() => setSettingsOpen((open) => !open)}
          aria-expanded={settingsOpen}
          aria-controls={panelId}
          className="t3-header__user"
          aria-label={auth.user ? `登入帳號 ${auth.user.display_name}` : '登入'}
        >
          <span className="t3-header__user-info">
            <span className="t3-header__avatar" aria-hidden><User /></span>
            <span className="max-w-[7rem] truncate">
              {auth.loading ? '讀取中…' : auth.user?.display_name ?? '登入'}
            </span>
          </span>
          <span className="t3-header__user-arrow" aria-hidden><ChevronDown /></span>
        </button>
        {/* 沒有系統基礎模組權限的帳號（例如廠商）看不到齒輪，不是點了才說權限不足 */}
        {auth.can('system.health.view') ? (
        <>
        <HeaderDivider />
        <HeaderIconButton settings label={t('shell.settings')} icon={<Settings />} onPress={() => {
          setSettingsOpen(false);
          onOpenSystemFoundation();
        }} />
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
