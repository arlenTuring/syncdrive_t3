import { useState, useEffect } from 'react';
import type { ClockWidget } from '../types';
import { useOperatingClock } from '../utils/operatingClock';

function formatDate(date: Date, fmt: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  if (fmt === 'MM/DD/YYYY') return `${m}/${d}/${y}`;
  if (fmt === 'DD/MM/YYYY') return `${d}/${m}/${y}`;
  return `${y}-${m}-${d}`;
}

/**
 * 時鐘顯示營運時間：正式營運就是實際時間；執行端加速重播時顯示重播到的營運時刻，
 * 日期與時間仍使用同一個營運時鐘；重播資訊留在模擬器控制介面。
 */
export function ClockWidgetView({ widget }: { widget: ClockWidget }) {
  const clock = useOperatingClock();
  const [now, setNow] = useState(() => new Date(clock.operatingNow()));

  useEffect(() => {
    setNow(new Date(clock.operatingNow()));
    const step = clock.advancing ? 200 : 1000;
    const timer = setInterval(() => setNow(new Date(clock.operatingNow())), step);
    return () => clearInterval(timer);
  }, [clock]);

  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();

  let timeStr: string;
  if (widget.format === '12h') {
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    timeStr = widget.showSeconds
      ? `${String(h12).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} ${period}`
      : `${String(h12).padStart(2,'0')}:${String(m).padStart(2,'0')} ${period}`;
  } else {
    timeStr = widget.showSeconds
      ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
      : `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }

  const dateStr = formatDate(now, widget.dateFormat);

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 2, padding: 4, boxSizing: 'border-box',
      overflow: 'hidden',
    }}>
      <div style={{
        fontSize: widget.fontSize,
        color: widget.color,
        fontFamily: widget.fontFamily || 'monospace',
        fontWeight: 700,
        letterSpacing: '0.02em',
        lineHeight: 1.1,
        whiteSpace: 'nowrap',
      }}>
        {timeStr}
      </div>
      {widget.showDate && (
        <div style={{
          fontSize: widget.dateFontSize,
          color: widget.dateColor,
          fontFamily: widget.fontFamily || 'monospace',
          letterSpacing: '0.05em',
        }}>
          {dateStr}
        </div>
      )}
    </div>
  );
}
