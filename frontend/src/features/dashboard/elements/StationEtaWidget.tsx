import { useEffect, useMemo, useState } from 'react';
import type { StationEtaWidget } from '../types';
import { useWidgetData } from './useWidgetData';
import { useOperatingClock } from '../utils/operatingClock';
import { useIsEditMode } from '../utils/widgetEditPreview';

type StationEvent = {
  key: string;
  event: 'arrive' | 'depart';
  vehicle_code: string;
  trip_code: string;
  station_id: string;
  station_name: string;
  at: number;
  kind: 'live' | 'plan';
  at_station: boolean;
};
type Group = { station_id: string; state: 'ok' | 'no_vehicle' | 'stale'; events: StationEvent[]; stale_vehicles: string[] };
type Response = { plan: { shift_name: string } | null; stations: Group[]; source?: string };

type StationConfig = StationEtaWidget['stations'][number];

/** 這一站要列哪幾種（舊設定沒有 events：只列到站） */
export function stationEvents(station: StationConfig): Array<'arrive' | 'depart'> {
  return station.events?.length ? station.events : ['arrive'];
}

/** 清單的網址：到站、出發的站點各自帶上 */
export function stationEtaUrl(widget: Pick<StationEtaWidget, 'dataUrl' | 'stations' | 'limit'>): string {
  const base = widget.dataUrl || '';
  const pick = (event: 'arrive' | 'depart') => widget.stations
    .filter((s) => s.stationId.trim() && stationEvents(s).includes(event))
    .map((s) => encodeURIComponent(s.stationId.trim()));
  const arrive = pick('arrive');
  const depart = pick('depart');
  if (!base || (arrive.length === 0 && depart.length === 0)) return '';
  const params = [
    arrive.length ? `arrive=${arrive.join(',')}` : '',
    depart.length ? `depart=${depart.join(',')}` : '',
    `limit=${Math.max(1, Math.min(10, widget.limit || 3))}`,
  ].filter(Boolean).join('&');
  return `${base}${base.includes('?') ? '&' : '?'}${params}`;
}

function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 剩餘時間 → 「X分Y秒」（一小時以上「X時Y分」） */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total >= 3600) return `${Math.floor(total / 3600)}時${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}分`;
  return `${Math.floor(total / 60)}分${String(total % 60).padStart(2, '0')}秒`;
}

/** 一列的主要文字：幾分幾秒到站／出發；時間到了就是即將到站／即將出發 */
export function eventPhrase(event: Pick<StationEvent, 'event' | 'at' | 'at_station'>, operatingNow: number): string {
  const verb = event.event === 'arrive' ? '到站' : '出發';
  const remain = event.at - operatingNow;
  if (remain <= 0) return event.event === 'depart' && event.at_station ? '停靠中，即將出發' : `即將${verb}`;
  return `${formatCountdown(remain)}${verb}`;
}

/**
 * 站點到站／出發清單。倒數用營運時間（加速重播時跟著倍速走）；即時推估與計畫時刻分開標示，
 * 沒有即時資料時不冒充即時。無車接近、車端資料過期、查詢失敗分別呈現。
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
  const [, setTick] = useState(0);
  useEffect(() => {
    // 倒數到秒：正常速度每秒更新；加速時更密，才不會一跳好幾十秒
    const step = clock.advancing ? Math.max(100, Math.round(1000 / Math.max(1, clock.rate))) : 1000;
    const timer = setInterval(() => setTick((n) => n + 1), step);
    return () => clearInterval(timer);
  }, [clock.advancing, clock.rate]);

  const response = (data[0] ?? null) as Response | null;
  const labelOf = useMemo(() => new Map(widget.stations.map((s) => [s.stationId, s.label || s.stationId])), [widget.stations]);
  const operatingNow = clock.operatingNow();
  const rows = useMemo(() => {
    const all = (response?.stations ?? []).flatMap((g) => g.events ?? []);
    // 到站時刻已經過了半分鐘還在清單上（等下一次查詢確認）：先拿掉；停靠中的出發不拿
    return all
      .filter((e) => e.at >= operatingNow - 30_000 || (e.event === 'depart' && e.at_station))
      .sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))
      .slice(0, Math.max(1, widget.limit || 3));
  }, [response, operatingNow, widget.limit]);
  const staleVehicles = [...new Set((response?.stations ?? []).flatMap((g) => g.stale_vehicles ?? []))];

  let message: { text: string; tone: 'muted' | 'warn' | 'error' } | null = null;
  if (!url) message = { text: isEditMode ? '請在屬性設定站點 ID' : '未設定站點', tone: 'warn' };
  else if (error && !response) message = { text: `查詢失敗：${error}`, tone: 'error' };
  else if (!response && loading) message = { text: '載入中…', tone: 'muted' };
  else if (response && !response.plan && rows.length === 0) message = { text: '尚未部署每日計畫', tone: 'muted' };
  else if (rows.length === 0) {
    message = staleVehicles.length
      ? { text: `車端資料過期（${staleVehicles.join('、')}），無即時資訊`, tone: 'warn' }
      : { text: '目前無車到站或出發', tone: 'muted' };
  }

  const fs = widget.fontSize || 13;
  return (
    <div
      title={response?.source ? `資料：${response.source}` : undefined}
      style={{
        width: '100%', height: '100%', boxSizing: 'border-box', padding: '4px 8px',
        background: widget.backgroundColor, border: `1px solid ${widget.borderColor}`,
        borderRadius: widget.borderRadius, color: widget.color, overflow: 'hidden',
        display: 'flex', flexDirection: 'column', gap: 2, fontSize: fs,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontWeight: 700 }}>
        <span>{widget.title}</span>
        {error && response && <span style={{ color: '#F87171', fontSize: fs * 0.8, fontWeight: 400 }}>更新失敗，顯示上次資料</span>}
      </div>
      {message ? (
        <div style={{ color: message.tone === 'error' ? '#F87171' : message.tone === 'warn' ? '#FBBF24' : widget.mutedColor, fontSize: fs * 0.9 }}>
          {message.text}
        </div>
      ) : (
        rows.map((row) => (
          <div
            key={row.key}
            title={`${row.trip_code}｜${row.kind === 'live' ? '即時推估' : '計畫時刻'} ${hhmm(row.at)}`}
            style={{ display: 'flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}
          >
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: row.event === 'arrive' ? '#7DD3FC' : '#FCD34D' }}>
              {eventPhrase(row, operatingNow)}
            </span>
            <span style={{ fontFamily: 'monospace' }}>{row.vehicle_code}</span>
            <span style={{ color: widget.mutedColor, overflow: 'hidden', textOverflow: 'ellipsis' }}>{labelOf.get(row.station_id) ?? row.station_name}</span>
            <span style={{ marginLeft: 'auto', fontSize: fs * 0.75, color: row.kind === 'live' ? '#34D399' : widget.mutedColor }}>
              {row.kind === 'live' ? '即時' : '計畫'}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
