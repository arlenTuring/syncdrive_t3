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
 * 並註明營運日、倍速與狀態，看的人才知道畫面是每日計畫的哪個時點。
 */
export function ClockWidgetView({ widget }: { widget: ClockWidget }) {
  const clock = useOperatingClock();
  const replay = clock.snapshot?.mode === 'replay' ? clock.snapshot : null;
  const [now, setNow] = useState(() => new Date(clock.operatingNow()));

  useEffect(() => {
    setNow(new Date(clock.operatingNow()));
    // 加速時一秒跳好幾分鐘，更新密一點才看得出在走
    const step = replay && clock.advancing ? 200 : 1000;
    const timer = setInterval(() => setNow(new Date(clock.operatingNow())), step);
    return () => clearInterval(timer);
  }, [clock, replay]);

  const replayNote = replay
    ? `營運日 ${replay.operating_day}｜${replay.rate}× 重播${
      replay.ended ? '（已結束）' : replay.stale ? '（執行端中斷）' : replay.paused ? '（暫停）' : ''
    }${replay.lag_ms > 1000 && !replay.ended ? `｜執行落後 ${Math.round(replay.lag_ms / 1000)} 秒` : ''}`
    : null;

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
      {replayNote && (
        <div
          title="營運時間由執行端推進；班次狀態、延誤、ETA、倒數都以此為準"
          style={{
            fontSize: Math.max(10, Math.round((widget.dateFontSize || 12) * 0.85)),
            color: '#FBBF24',
            fontFamily: widget.fontFamily || 'monospace',
            whiteSpace: 'nowrap',
          }}
        >
          {replayNote}
        </div>
      )}
    </div>
  );
}
