/**
 * ShiftListWidget
 * 儀表板「班次清單」元件：含正線班次 / 整備班次兩個 Tab，
 * 每列渲染一班次資料（班次代號、運行方向、執行載具、路線進度、狀態、發車時間）。
 */
import { useState, useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import type { ShiftListWidget } from '../types';
import { useWidgetData } from './useWidgetData';
import { useIsEditMode } from '../utils/widgetEditPreview';

// ─── 型別 ─────────────────────────────────────────────────────────────────────

interface ShiftRow {
  shift_key?: string;
  trip_code?: string;
  vehicle_code?: string;
  direction_label?: string;
  direction_pill_bg?: string;
  direction_pill_color?: string;
  status_label?: string;
  status_bg?: string;
  status_color?: string;
  depart_time?: string;
  end_time?: string;
  // 路線進度相關
  st_a?: string;
  st_b?: string;
  st_c?: string;
  segment_index?: number | string;
  segment_remain_pct?: number | string;
  route_progress?: number | string;
  // 整備專用
  maint_type_label?: string;
  maint_type_bg?: string;
  maint_type_color?: string;
  line_kind?: string;
}

// ─── 內聯路線進度軌道 ─────────────────────────────────────────────────────────

function InlineRouteTrack({ row, isMainline }: { row: ShiftRow; isMainline: boolean }) {
  const ACTIVE_COLOR = '#3B82F6';
  const INACTIVE_COLOR = '#3f3f46';
  const DOT_ACTIVE = '#94a3b8';

  // 計算進度百分比（0-100）
  const segIdx = Number(row.segment_index ?? 0);
  const segRemain = Number(row.segment_remain_pct ?? 100);
  // 每段佔整體 50%（3 站 → 2 段）
  const segCount = isMainline ? 2 : 1;
  const completedSegs = segIdx;
  const currentSegProgress = 1 - segRemain / 100;
  const rawPct =
    segCount > 0 ? ((completedSegs + currentSegProgress) / segCount) * 100 : Number(row.route_progress ?? 0);
  const pct = Math.min(100, Math.max(0, rawPct));

  // 站名只用 SQL 給的；沒給就顯示「—」，不補寫死的站名
  const stations = isMainline
    ? [row.st_a ?? '—', row.st_b ?? '—', row.st_c ?? '—']
    : [row.st_a ?? '—', row.st_c ?? '—'];

  const stationPcts = isMainline ? [0, 50, 100] : [0, 100];

  return (
    <div style={{ position: 'relative', width: '100%', height: 40 }}>
      {/* 軌道背景 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 12,
          height: 3,
          borderRadius: 2,
          backgroundColor: INACTIVE_COLOR,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${pct}%`,
            backgroundColor: ACTIVE_COLOR,
            borderRadius: 2,
            transition: 'width 0.4s ease',
          }}
        />
      </div>

      {/* 站點圓點 + 標籤 */}
      {stations.map((name, i) => {
        const sp = stationPcts[i];
        const passed = pct >= sp;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: 7,
              left: `${sp}%`,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: passed ? DOT_ACTIVE : INACTIVE_COLOR,
                border: `2px solid ${passed ? ACTIVE_COLOR : INACTIVE_COLOR}`,
                zIndex: 2,
              }}
            />
            <span
              style={{
                fontSize: 9,
                color: passed ? '#94a3b8' : '#52525b',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              {name}
            </span>
          </div>
        );
      })}

      {/* 車輛圖示 */}
      <div
        style={{
          position: 'absolute',
          top: 4,
          left: `${pct}%`,
          transform: 'translateX(-50%)',
          width: 18,
          height: 18,
          borderRadius: 3,
          backgroundColor: ACTIVE_COLOR,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 3,
          fontSize: 10,
        }}
      >
        🚌
      </div>
    </div>
  );
}

// ─── 表格列 ───────────────────────────────────────────────────────────────────

function ShiftTableRow({
  row,
  isMainline,
  fontSize,
  isEven,
}: {
  row: ShiftRow;
  isMainline: boolean;
  fontSize: number;
  isEven: boolean;
}) {
  const fs = fontSize;
  const pillFs = Math.max(10, fs - 1);

  return (
    <tr
      style={{
        backgroundColor: isEven ? 'rgba(255,255,255,0.02)' : 'transparent',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {/* 班次代號 */}
      <td style={{ padding: '6px 8px', fontSize: fs, color: '#cbd5e1', fontWeight: 600, whiteSpace: 'nowrap' }}>
        {row.trip_code ?? '—'}
      </td>

      {/* 運行方向 */}
      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
        {isMainline ? (
          <span
            style={{
              display: 'inline-block',
              fontSize: pillFs,
              fontWeight: 600,
              borderRadius: 20,
              padding: '1px 8px',
              backgroundColor: row.direction_pill_bg ?? '#1e3a8a',
              color: row.direction_pill_color ?? '#93c5fd',
            }}
          >
            {row.direction_label ?? '—'}
          </span>
        ) : (
          <span style={{ fontSize: fs, color: '#71717a' }}>—</span>
        )}
      </td>

      {/* 執行載具 */}
      <td style={{ padding: '6px 8px', fontSize: fs, color: '#94a3b8', whiteSpace: 'nowrap' }}>
        {row.vehicle_code ?? '—'}
      </td>

      {/* 路線進度 */}
      <td style={{ padding: '6px 8px', minWidth: 260 }}>
        <InlineRouteTrack row={row} isMainline={isMainline} />
      </td>

      {/* 班次狀態 */}
      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
        {isMainline ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: pillFs,
              fontWeight: 600,
              borderRadius: 6,
              padding: '2px 8px',
              backgroundColor: row.status_bg ?? '#27272a',
              color: row.status_color ?? '#a1a1aa',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: row.status_color ?? '#a1a1aa',
                flexShrink: 0,
              }}
            />
            {row.status_label ?? '—'}
          </span>
        ) : (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: pillFs,
              fontWeight: 600,
              borderRadius: 6,
              padding: '2px 8px',
              backgroundColor: row.maint_type_bg ?? '#422006',
              color: row.maint_type_color ?? '#fdba74',
            }}
          >
            {row.maint_type_label ?? row.status_label ?? '—'}
          </span>
        )}
      </td>

      {/* 發車時間（預計/實際） */}
      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: fs, color: '#94a3b8' }}>
          {row.depart_time ?? '—'}
          {row.end_time ? (
            <span style={{ color: '#52525b', margin: '0 3px' }}>~</span>
          ) : null}
          {row.end_time ? (
            <span style={{ color: '#52525b' }}>{row.end_time}</span>
          ) : null}
        </span>
      </td>

      {/* 查看詳情 */}
      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
        <button
          type="button"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            fontSize: pillFs,
            color: '#3B82F6',
            fontWeight: 600,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          查看詳情
          <ExternalLink size={10} />
        </button>
      </td>
    </tr>
  );
}

// ─── 主元件 ───────────────────────────────────────────────────────────────────

export function ShiftListWidgetView({ widget }: { widget: ShiftListWidget }) {
  const isEditMode = useIsEditMode();
  const [activeTab, setActiveTab] = useState<'mainline' | 'maintenance'>(
    widget.defaultTab === 'maintenance' ? 'maintenance' : 'mainline',
  );

  const DS = widget.dataSourceId ?? 'default-internal';
  const fs = widget.fontSize ?? 12;

  const REFRESH_MODE = 'event' as const;

  // 正線班次資料
  const mainlineState = useWidgetData({
    dataSourceId: DS,
    sqlQuery: widget.mainlineSqlQuery,
    refreshMode: REFRESH_MODE,
  });

  // 整備班次資料
  const maintenanceState = useWidgetData({
    dataSourceId: DS,
    sqlQuery: widget.maintenanceSqlQuery,
    refreshMode: REFRESH_MODE,
  });

  // 目前班表名稱
  const scheduleState = useWidgetData({
    dataSourceId: DS,
    sqlQuery: widget.currentScheduleSqlQuery,
    refreshMode: REFRESH_MODE,
  });

  const currentScheduleName = useMemo(() => {
    const row = scheduleState.data[0];
    if (!row) return '';
    return (
      String(row.schedule_name ?? row.name ?? '')
    );
  }, [scheduleState.data]);

  const isMainline = activeTab === 'mainline';
  const currentState = isMainline ? mainlineState : maintenanceState;
  const rows = currentState.data as ShiftRow[];

  // ─── HEADER ROW ───────────────────────────────────────────────────────────

  const HEADER_COLS = isMainline
    ? ['班次代號', '運行方向', '執行載具', '路線進度', '班次狀態', '發車時間（預計/實際）', '']
    : ['班次代號', '整備類型', '執行載具', '路線進度', '班次狀態', '發車時間（預計/實際）', ''];

  const TAB_UNDERLINE = '2px solid #3B82F6';

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: widget.backgroundColor ?? 'transparent',
        borderRadius: widget.borderRadius ?? 8,
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif',
      }}
    >
      {/* ── Tab Bar ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
          padding: '0 8px',
          backgroundColor: 'rgba(255,255,255,0.02)',
        }}
      >
        {/* 左側 Tab */}
        <div style={{ display: 'flex', gap: 0 }}>
          {(['mainline', 'maintenance'] as const).map((tab) => {
            const label = tab === 'mainline' ? '正線班次' : '整備班次';
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '10px 16px',
                  fontSize: fs + 1,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#3B82F6' : '#71717a',
                  background: 'none',
                  border: 'none',
                  borderBottom: isActive ? TAB_UNDERLINE : '2px solid transparent',
                  cursor: 'pointer',
                  transition: 'color 0.15s, border-color 0.15s',
                  marginBottom: -1,
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* 右側：目前班表 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 4 }}>
          <span style={{ fontSize: fs - 1, color: '#52525b', whiteSpace: 'nowrap' }}>目前班表</span>
          {currentScheduleName ? (
            <span
              style={{
                fontSize: fs - 1,
                color: '#94a3b8',
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderRadius: 4,
                padding: '2px 8px',
                border: '1px solid rgba(255,255,255,0.1)',
                whiteSpace: 'nowrap',
              }}
            >
              {currentScheduleName}
            </span>
          ) : (
            <span
              style={{
                display: 'inline-block',
                width: 120,
                height: 20,
                borderRadius: 4,
                backgroundColor: 'rgba(255,255,255,0.06)',
              }}
            />
          )}
        </div>
      </div>

      {/* ── 表格區塊 ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {currentState.loading && rows.length === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#52525b',
              fontSize: fs,
            }}
          >
            載入中…
          </div>
        ) : rows.length === 0 && !isEditMode ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#52525b',
              fontSize: fs,
            }}
          >
            暫無{isMainline ? '正線' : '整備'}班次
          </div>
        ) : (
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              tableLayout: 'auto',
            }}
          >
            {/* 表頭 */}
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {HEADER_COLS.map((col, i) => (
                  <th
                    key={i}
                    style={{
                      padding: '6px 8px',
                      textAlign: 'left',
                      fontSize: fs - 1,
                      color: '#52525b',
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      userSelect: 'none',
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* 編輯模式下若無資料，顯示佔位列 */}
              {rows.length === 0 && isEditMode
                ? Array.from({ length: 3 }).map((_, i) => (
                    <tr
                      key={`placeholder-${i}`}
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        opacity: 0.3,
                      }}
                    >
                      {HEADER_COLS.map((_, j) => (
                        <td key={j} style={{ padding: '8px 8px' }}>
                          <div
                            style={{
                              height: 14,
                              borderRadius: 4,
                              backgroundColor: 'rgba(255,255,255,0.08)',
                              width: j === 3 ? 260 : j === 0 ? 60 : 80,
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((row, i) => (
                    <ShiftTableRow
                      key={row.shift_key ?? `row-${i}`}
                      row={row}
                      isMainline={isMainline}
                      fontSize={fs}
                      isEven={i % 2 === 0}
                    />
                  ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
