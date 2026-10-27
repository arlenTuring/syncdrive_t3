import { useEffect, useReducer, type CSSProperties, type ReactNode } from 'react';
import { BusFront, MapPin } from 'lucide-react';
import type { StationEtaWidget } from '../types';
import { useWidgetData } from './useWidgetData';
import { useOperatingClock } from '../utils/operatingClock';
import { useIsEditMode } from '../utils/widgetEditPreview';
import { MAP_PLATFORM_THEME as T } from '../constants/mapPlatformTheme';
import {
  cardMessage,
  cardRows,
  cardScale,
  directionOf,
  eventStatus,
  formatCountdown,
  nextTickDelay,
  placeLabel,
  rowTag,
  stationEtaUrl,
  visibleEvents,
  type StationEtaResponse,
  type StationEvent,
} from './stationEtaModel';

/** 最小可讀字級（畫布單位） */
const MIN_FONT = 10;

const pad2 = (n: number) => String(n).padStart(2, '0');
function clockText(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * 倒數重畫：只在畫面上的數字真的會換時才重畫（營運時間每跨一秒）；切回前景立刻重算。
 * 每次都用 at − operatingNow 重算，不是每秒減一，所以背景分頁、卡頓、重連之後數字直接正確。
 * 只有重畫，不重新查詢：資料仍由事件失效／受控重試更新。
 */
function useCountdownTick(ats: number[], clock: ReturnType<typeof useOperatingClock>) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const atsKey = ats.join(',');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const delay = nextTickDelay(ats, clock.operatingNow(), clock.rate, clock.advancing);
      timer = setTimeout(() => {
        force();
        schedule();
      }, delay);
    };
    schedule();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer) clearTimeout(timer);
      force();
      schedule();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // ats 以 atsKey 代表；clock 換了（暫停、倍速、換段）要重排
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atsKey, clock]);
}

function directionColor(event: StationEvent): string {
  const dir = directionOf(event);
  return dir === 'up' ? T.accentBlue : dir === 'down' ? T.directionPurple : T.secondaryText;
}

/** 來源（即時推估／計畫時刻）只放 tooltip，畫面不畫 */
function rowTooltip(event: StationEvent, place: string): string {
  return [
    `${event.vehicle_code}｜${event.trip_code}`,
    `${event.event === 'arrive' ? '到站' : '出發'} ${place}`,
    `${event.kind === 'live' ? '即時推估' : '計畫時刻'} ${clockText(event.at)}（營運時間）`,
  ].join('\n');
}

/** 倒數；資料中斷時不把舊 ETA 當倒數 */
function countdownText(event: StationEvent, operatingNow: number): string {
  return event.time_state === 'stale' ? '--:--' : formatCountdown(event.at - operatingNow);
}

function Place({ event, place, fontSize, icon, gap }: { event: StationEvent; place: string; fontSize: number; icon: number; gap: number }) {
  const color = directionColor(event);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap, minWidth: 0, color, fontSize, fontWeight: 500 }}>
      <MapPin size={icon} aria-hidden style={{ flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place}</span>
    </span>
  );
}

/**
 * 站點到站動態卡片（T3、N2W、S2W 共用）：標題下照時刻由近到遠最多三列；即將到站的列放大（大號分:秒倒數），
 * 其餘是緊湊列；同時兩班即將到站只排兩列（cardRows）。尺寸照設計稿 320×254（一大兩小）為 1×，依卡片尺寸等比（cardScale）；倒數用營運時間。
 * 卡片不畫誤點／延誤與即時／計畫來源；沒車、未部署、資料中斷、查詢失敗各自呈現。
 */
export function StationEtaWidgetView({ widget }: { widget: StationEtaWidget }) {
  const isEditMode = useIsEditMode();
  const url = stationEtaUrl(widget);
  const { data, loading, error } = useWidgetData({
    dataUrl: url || undefined,
    refreshMode: widget.refreshMode ?? 'event',
    refreshInterval: widget.refreshInterval,
    invalidateTags: widget.invalidateTags,
  });
  const clock = useOperatingClock();
  const response = (data[0] ?? null) as StationEtaResponse | null;
  const operatingNow = clock.operatingNow();
  const rows = cardRows(visibleEvents(response, operatingNow, widget.limit), operatingNow);
  useCountdownTick(rows.map((r) => r.event.at), clock);
  const message = cardMessage({ url, isEditMode, response, loading, error, rows: rows.length });

  const s = cardScale(widget.width, widget.height, widget.fontSize);
  const u = (n: number) => n * s;
  const fs = (n: number) => Math.max(MIN_FONT, n * s);
  const soft = T.secondaryText;
  const [titleStation, ...titleRest] = (widget.title || '').split(' ');

  const card: CSSProperties = {
    width: '100%', height: '100%', boxSizing: 'border-box', padding: `0 ${u(12)}px`,
    background: widget.backgroundColor || T.cardBackground,
    border: `1px solid ${widget.borderColor || T.cardBorder}`,
    borderRadius: u(widget.borderRadius ?? 20),
    color: widget.color || T.primaryText,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  };

  let body: ReactNode;
  if (message) {
    body = (
      <div
        title={message.detail}
        style={{
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u(4),
          fontSize: fs(18), textAlign: 'center', paddingBottom: u(10),
          color: message.tone === 'error' ? T.danger : message.tone === 'warn' ? T.warning : (widget.mutedColor || T.mutedText),
        }}
      >
        <span>{message.text}</span>
        {message.detail && isEditMode && <span style={{ fontSize: fs(12), color: T.mutedText }}>{message.detail}</span>}
      </div>
    );
  } else if (rows.length) {
    body = (
      <div
        style={{
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: u(6),
          overflowY: 'auto', paddingBottom: u(10), boxSizing: 'border-box',
        }}
      >
        {rows.map(({ event: row, big }) => {
          const place = placeLabel(row, widget.stations);
          if (big) {
            const status = eventStatus(row, operatingNow);
            return (
              <div
                key={row.key}
                data-eta-role="hero"
                title={rowTooltip(row, place)}
                style={{
                  background: T.itemBackground, borderRadius: u(14), padding: `${u(8)}px ${u(12)}px`, minHeight: u(96),
                  boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  flexShrink: 0, minWidth: 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: u(6), fontSize: fs(18), color: soft, whiteSpace: 'nowrap', minWidth: 0 }}>
                  <BusFront size={u(16)} aria-hidden style={{ flexShrink: 0 }} />
                  <span style={{ flexShrink: 0 }}>{row.vehicle_code}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', color: status.tone === 'stale' ? T.warning : soft }}>
                    {status.text}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: u(8), minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: fs(48), fontWeight: 700, lineHeight: `${fs(52)}px`, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                      color: row.time_state === 'stale' ? T.mutedText : T.primaryText, flexShrink: 0,
                    }}
                  >
                    {countdownText(row, operatingNow)}
                  </span>
                  <span style={{ minWidth: 0, display: 'flex', paddingBottom: u(6) }}>
                    <Place event={row} place={place} fontSize={fs(20)} icon={u(18)} gap={u(4)} />
                  </span>
                </div>
              </div>
            );
          }
          const tag = rowTag(row);
          return (
            <div
              key={row.key}
              data-eta-role="row"
              title={rowTooltip(row, place)}
              style={{
                display: 'flex', alignItems: 'center', gap: u(6), minHeight: u(46), padding: `0 ${u(10)}px`, borderRadius: u(12),
                background: T.itemBackground, whiteSpace: 'nowrap', flexShrink: 0, minWidth: 0, boxSizing: 'border-box', color: soft,
              }}
            >
              <BusFront size={u(16)} aria-hidden style={{ flexShrink: 0 }} />
              <span style={{ fontSize: fs(18), flexShrink: 0 }}>{row.vehicle_code}</span>
              <span
                style={{
                  fontSize: fs(26), fontWeight: 600, fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                  color: row.time_state === 'stale' ? T.mutedText : T.primaryText,
                }}
              >
                {countdownText(row, operatingNow)}
              </span>
              {tag && (
                <span style={{ fontSize: fs(14), flexShrink: 0, color: tag.tone === 'stale' ? T.warning : soft }}>{tag.text}</span>
              )}
              <span style={{ marginLeft: 'auto', minWidth: 0, display: 'flex' }}>
                <Place event={row} place={place} fontSize={fs(18)} icon={u(18)} gap={u(4)} />
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div title={response?.source ? `資料：${response.source}` : undefined} style={card}>
      <div style={{ height: u(44), display: 'flex', alignItems: 'center', gap: u(8), flexShrink: 0, minWidth: 0, whiteSpace: 'nowrap' }}>
        <BusFront size={u(18)} aria-hidden style={{ flexShrink: 0 }} />
        <span style={{ display: 'flex', alignItems: 'baseline', gap: u(6), minWidth: 0, overflow: 'hidden' }}>
          <span style={{ fontSize: fs(24), fontWeight: 600, flexShrink: 0 }}>{titleStation}</span>
          {titleRest.length > 0 && (
            <span style={{ fontSize: fs(20), fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>{titleRest.join(' ')}</span>
          )}
        </span>
        {error && response && (
          <span title={error} style={{ marginLeft: 'auto', fontSize: fs(14), color: T.warning, flexShrink: 0 }}>更新失敗</span>
        )}
      </div>
      {body}
    </div>
  );
}
