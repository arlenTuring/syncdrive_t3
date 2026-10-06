import { useEffect, useMemo, useState } from 'react';
import type { StationEtaWidget } from '../types';
import { useWidgetData } from './useWidgetData';
import { useOperatingClock } from '../utils/operatingClock';
import { useIsEditMode } from '../utils/widgetEditPreview';

type Arrival = {
  key: string;
  vehicle_code: string;
  trip_code: string;
  station_id: string;
  station_name: string;
  eta_at: number;
  kind: 'live' | 'plan';
  delay_seconds: number | null;
};
type Group = { station_id: string; state: 'ok' | 'no_vehicle' | 'stale'; arrivals: Arrival[]; stale_vehicles: string[] };
type Response = { plan: { shift_name: string } | null; stations: Group[]; source?: string };

/** 到站清單的網址：站點 ID 照設定的順序帶上 */
export function stationEtaUrl(widget: Pick<StationEtaWidget, 'dataUrl' | 'stations' | 'limit'>): string {
  const base = widget.dataUrl || '';
  const ids = widget.stations.map((s) => s.stationId.trim()).filter(Boolean);
  if (!base || ids.length === 0) return '';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}station_id=${ids.map(encodeURIComponent).join(',')}&limit=${Math.max(1, Math.min(10, widget.limit || 3))}`;
}

function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 站點到站清單。抵達時刻與倒數都用營運時間（加速重播時跟著倍速走）；即時預估與計畫時刻分開標示，
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
    // 倒數照營運時間走：加速時更新密一點
    const step = clock.advancing ? Math.max(200, Math.round(1000 / Math.max(1, clock.rate / 10))) : 5000;
    const timer = setInterval(() => setTick((n) => n + 1), step);
    return () => clearInterval(timer);
  }, [clock.advancing, clock.rate]);

  const response = (data[0] ?? null) as Response | null;
  const labelOf = useMemo(() => new Map(widget.stations.map((s) => [s.stationId, s.label || s.stationId])), [widget.stations]);
  const operatingNow = clock.operatingNow();
  const rows = useMemo(() => {
    const all = (response?.stations ?? []).flatMap((g) => g.arrivals ?? []);
    // 營運時間已經走過去的（查詢之後才到站）先拿掉，等下一次查詢確認
    return all
      .filter((a) => a.eta_at >= operatingNow - 30_000)
      .sort((a, b) => a.eta_at - b.eta_at || a.key.localeCompare(b.key))
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
      ? { text: `車端資料過期（${staleVehicles.join('、')}），無即時 ETA`, tone: 'warn' }
      : { text: '目前無車接近', tone: 'muted' };
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
        rows.map((row) => {
          const minutes = Math.max(0, Math.round((row.eta_at - operatingNow) / 60_000));
          return (
            <div key={row.key} style={{ display: 'flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{hhmm(row.eta_at)}</span>
              <span style={{ fontFamily: 'monospace' }}>{row.vehicle_code}</span>
              <span style={{ color: widget.mutedColor, overflow: 'hidden', textOverflow: 'ellipsis' }}>{labelOf.get(row.station_id) ?? row.station_name}</span>
              <span style={{ marginLeft: 'auto', fontSize: fs * 0.8, color: row.kind === 'live' ? '#34D399' : widget.mutedColor }}>
                {row.kind === 'live' ? `即時 ${minutes} 分` : `計畫 ${minutes} 分`}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
