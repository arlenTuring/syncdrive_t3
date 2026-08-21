import type { DoorVisualState } from '../constants';

const STATE_COLOR: Record<DoorVisualState, string> = {
  open: '#22C55E',
  closing: '#F59E0B',
  closed: '#51A2FF',
  opening: '#F59E0B',
  alarm: '#EF4444',
  offline: '#A1A1AA',
};

const STATE_ARIA: Record<DoorVisualState, string> = {
  open: '常態開',
  closing: '動作中關',
  closed: '常態關',
  opening: '動作中開',
  alarm: '對位不一致告警',
  offline: '失去連線',
};

type DoorLinkIndicatorProps = {
  state?: DoorVisualState;
  openPercent?: number;
  label: string;
  className?: string;
};

/** 0＝完全關閉（兩扇貼近），1＝完全開啟（兩扇退至兩側） */
function splitAmount(state: DoorVisualState, openPercent: number): number {
  if (state === 'open') return 1;
  if (state === 'closed' || state === 'alarm' || state === 'offline') return 0;
  const pct = Number.isFinite(openPercent) ? Math.min(100, Math.max(0, openPercent)) : 50;
  return pct / 100;
}

/**
 * 列表卡門位指示器：永遠是「兩片」門板組合，不是一整塊色塊。
 * 關閉時兩片並排僅留中縫；開／關動作時兩片左右退開。
 */
export function DoorLinkIndicator({
  state = 'closed',
  openPercent = 0,
  label,
  className = '',
}: DoorLinkIndicatorProps) {
  const color = STATE_COLOR[state];
  const amount = splitAmount(state, openPercent);
  const inMotion = state === 'opening' || state === 'closing';
  /** 每扇最大外移距離（px）；關閉時為 0，僅保留中縫 */
  const slide = Math.round(amount * 11);

  return (
    <div className={`flex min-w-0 flex-1 flex-col items-center gap-2 ${className}`}>
      <div
        className="relative h-10 w-11 shrink-0"
        aria-label={`${label} ${STATE_ARIA[state]}`}
      >
        {/* 左門扇 */}
        <span
          className={[
            'absolute top-0 bottom-0 left-0 w-[calc(50%-0.5px)] rounded-sm transition-transform duration-500 ease-out',
            inMotion ? 'door-panel-opening' : '',
          ].join(' ')}
          style={{
            backgroundColor: color,
            transform: `translateX(-${slide}px)`,
          }}
          aria-hidden
        />
        {/* 右門扇 */}
        <span
          className={[
            'absolute top-0 bottom-0 right-0 w-[calc(50%-0.5px)] rounded-sm transition-transform duration-500 ease-out',
            inMotion ? 'door-panel-opening' : '',
          ].join(' ')}
          style={{
            backgroundColor: color,
            transform: `translateX(${slide}px)`,
          }}
          aria-hidden
        />
        {/* 中縫上下凹口（關閉／半開時可見，強調兩片接合） */}
        {amount < 0.85 ? (
          <>
            <span
              className="pointer-events-none absolute left-1/2 top-0 z-[1] h-1 w-1.5 -translate-x-1/2 rounded-b-sm bg-[#0a0a0b]"
              aria-hidden
            />
            <span
              className="pointer-events-none absolute bottom-0 left-1/2 z-[1] h-1 w-1.5 -translate-x-1/2 rounded-t-sm bg-[#0a0a0b]"
              aria-hidden
            />
          </>
        ) : null}
      </div>
      <span className="text-center text-xs tracking-[0.5px] text-zinc-200">{label}</span>
    </div>
  );
}
