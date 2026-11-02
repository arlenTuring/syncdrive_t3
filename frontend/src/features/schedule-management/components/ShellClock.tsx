import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveBrowserApiBaseUrl } from '../../../lib/browserApiBase';
import {
  acquireOperatingClock,
  operatingNowFrom,
  type OperatingClockState,
} from '../../dashboard/utils/operatingClock';

const pad = (value: number) => String(value).padStart(2, '0');

function formatClock(ms: number, locale: string): { time: string; date: string } {
  const date = new Date(ms);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date).replace('週', '');
  const open = locale.startsWith('zh') ? '（' : ' (';
  const close = locale.startsWith('zh') ? '）' : ')';
  return {
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    date: `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}${open}${weekday}${close}`,
  };
}

/**
 * 側欄左下角的日期時間，以營運時鐘為準，跟班表的「今天」一致。
 * 時鐘資料放在 ref：查詢結果進來不重畫，只有每秒的文字變動重畫這一小塊。
 */
export function ShellClock({ compact = false }: { compact?: boolean }) {
  const { i18n } = useTranslation();
  const clockRef = useRef<OperatingClockState>({ snapshot: null, receivedAt: 0, error: null });
  const [text, setText] = useState(() => formatClock(Date.now(), i18n.language));

  useEffect(() => acquireOperatingClock(resolveBrowserApiBaseUrl(), (state) => {
    clockRef.current = state;
  }), []);

  useEffect(() => {
    const tick = () => setText(formatClock(operatingNowFrom(clockRef.current), i18n.language));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [i18n.language]);

  return (
    <div className={`whitespace-nowrap tabular-nums ${compact ? 'py-1 text-center' : 'px-3 py-1.5'}`}>
      <div className={compact ? 'text-[11px] font-semibold text-zinc-100' : 'text-lg font-semibold leading-6 text-zinc-100'}>{text.time}</div>
      {compact ? null : <div className="text-xs text-zinc-500">{text.date}</div>}
    </div>
  );
}
