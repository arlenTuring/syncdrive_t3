import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEPLOYMENT_CURRENT_MODE_SQL,
  DEPLOYMENT_DATA_STATS_SQL,
  DEPLOYMENT_EXECUTING_SCHEDULE_SQL,
  DEPLOYMENT_MAJOR_EVENTS_SQL,
  DEPLOYMENT_VEHICLE_LIST_SQL,
  MAINLINE_SHIFTS_SQL,
  MAINTENANCE_SHIFTS_SQL,
} from '../../dashboard/constants/demoSql';
import { executeDatasourceQuery, getDataSourceById } from '../../dashboard/store/useDataSourceStore';
import { parseLegDistanceMax } from '../../dashboard/route-progress/legProgress';
import { subscribeDatasourceInvalidation } from '../../dashboard/utils/datasourceInvalidationBus';
import {
  fetchOperationShiftDetail,
  fetchOperationShiftList,
} from '../../shift-list/api/operationShiftApi';
import {
  readPendingScheduleAdjust,
  refreshPendingScheduleAdjust,
} from '../pendingScheduleAdjust';
import {
  FALLBACK_EVENT,
  FALLBACK_MAINLINE,
  FALLBACK_MAINTENANCE,
  FALLBACK_MODE,
  FALLBACK_SCHEDULE,
  FALLBACK_STATS,
  FALLBACK_VEHICLES,
} from '../fallback';
import type {
  CurrentModeData,
  DataStatsData,
  ExecutingScheduleData,
  MajorEventData,
  ShiftRow,
} from '../types';

const DS = 'default-internal';

/** 後端失效通知裡跟班次清單有關的標籤（backend datasource-invalidation.service.ts 的 DS_TAGS） */
const LIVE_TAGS = new Set([
  'table:operation_orders',
  'domain:mainline_shifts',
  'domain:maintenance_shifts',
  'domain:shift_center',
]);
/** 兩次清單重查至少隔多久（後端本身也限每秒一次） */
const LIVE_MIN_GAP_MS = 1_000;

function str(row: Record<string, unknown> | undefined, key: string, fallback = ''): string {
  const v = row?.[key];
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function num(row: Record<string, unknown> | undefined, key: string, fallback = 0): number {
  const v = Number(row?.[key]);
  return Number.isFinite(v) ? v : fallback;
}

/** NULL／空值是「不知道」，不能被 Number(null) 變成 0 */
function nullableNum(row: Record<string, unknown> | undefined, key: string): number | null {
  const v = row?.[key];
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 站序：有就用單上的（payload.stations）。進出廠、待命這類沒有站序的單，用單上的起點→終點；
 * 起訖同一點（原地待命、暫停）只畫一個點。不要補一條車根本不會走的固定路線。
 */
function routeStationsOf(row: Record<string, unknown>): string {
  const raw = str(row, 'route_stations').trim();
  if (raw && raw !== '[]') return raw;
  const point = (nameKey: string, idKey: string) => {
    const name = str(row, nameKey);
    return name && name !== '—' ? { name, station_id: str(row, idKey) || undefined } : null;
  };
  const ends = [point('st_a', 'origin_station_id'), point('st_c', 'destination_station_id')]
    .filter((item): item is { name: string; station_id: string | undefined } => item !== null);
  const sameSpot = ends.length === 2
    && (ends[0].station_id ? ends[0].station_id === ends[1].station_id : ends[0].name === ends[1].name);
  return JSON.stringify(sameSpot ? [ends[0]] : ends);
}

function mapShiftRow(row: Record<string, unknown>): ShiftRow {
  const delay = num(row, 'delay_minutes');
  let statusLabel = str(row, 'status_label', '—');
  if (delay > 0 && !statusLabel.includes('+')) {
    statusLabel = `${statusLabel === '延誤' ? '延遲' : statusLabel}+${delay}分`;
  }
  if (statusLabel === '準時') statusLabel = '準點';
  return {
    shiftKey: str(row, 'shift_key', str(row, 'trip_code')),
    tripCode: str(row, 'trip_code', '—'),
    directionLabel: str(row, 'direction_label', '—'),
    vehicleCode: str(row, 'vehicle_code', '—'),
    routeStations: routeStationsOf(row),
    // route_progress 不用：正線 SQL 沒有車端值時給固定 18，畫面會一直停在同一格。
    // 進度改由車端 MQTT 依距離推進（ShiftRouteTrack），SQL 只在還沒收到回報時墊底。
    segmentIndex: nullableNum(row, 'segment_index'),
    segmentRemainPct: nullableNum(row, 'segment_remain_pct'),
    legDistanceMax: parseLegDistanceMax(row?.leg_distance_max_m),
    statusLabel,
    statusBg: str(row, 'status_bg', 'rgba(34,197,94,0.2)'),
    statusColor: str(row, 'status_color', '#4ADE80'),
    departTime: str(row, 'depart_time', '—'),
    maintTypeLabel: str(row, 'maint_type_label') || undefined,
    orderStatus: str(row, 'order_status'),
  };
}

async function querySql(sql: string): Promise<Record<string, unknown>[]> {
  try {
    return await executeDatasourceQuery(DS, sql);
  } catch {
    return [];
  }
}

/**
 * 中心端主動取消一張正線訂單。orderId 是 MAINLINE_SHIFTS_SQL 的 shift_key，
 * 即 operation_orders.order_id——不是整備班次那種計畫區塊 id，那種沒有真訂單
 * 可以取消，呼叫端要先擋掉。
 *
 * 端點是內部用的（見 backend order.controller.ts 的 PUT order/cancel/:id），
 * 不掛 @ExternalApi，只有本機／內網打得到，不對協力廠商開放。
 */
export async function cancelShiftOrder(orderId: string): Promise<void> {
  const ds = getDataSourceById(DS);
  const backendUrl = ds?.backendUrl ?? '';
  const res = await fetch(`${backendUrl}/syncdrive-api/order/cancel/${encodeURIComponent(orderId)}`, {
    method: 'PUT',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `取消失敗（HTTP ${res.status}）`);
  }
}

/**
 * 即時調度引擎目前有沒有在自動下訂單。內部用端點（見 backend
 * dispatch.controller.ts），不掛 @ExternalApi。
 *
 * 拉不到（後端沒開、網路問題）回 null，畫面上顯示「狀態未知」而不是猜一個值——
 * 猜錯的話，行控人員會以為引擎已經停了，其實還在照常發車。
 */
export async function fetchDispatchEnabled(): Promise<boolean | null> {
  try {
    const ds = getDataSourceById(DS);
    const backendUrl = ds?.backendUrl ?? '';
    const res = await fetch(`${backendUrl}/syncdrive-api/dispatch/status`);
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.enabled === 'boolean' ? body.enabled : null;
  } catch {
    return null;
  }
}

/**
 * 暫停／恢復即時調度引擎下新訂單。暫停不影響已經在跑的訂單——車輛會把手上
 * 這一趟開完，只是不會再收到下一張，讓模擬器可以接手測試用的車輛而不用跟
 * 真實班表搶車。
 */
export async function setDispatchEnabled(enabled: boolean): Promise<void> {
  const ds = getDataSourceById(DS);
  const backendUrl = ds?.backendUrl ?? '';
  const res = await fetch(`${backendUrl}/syncdrive-api/dispatch/enable`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `設定失敗（HTTP ${res.status}）`);
  }
}

function readDeploymentMeta(body: Record<string, unknown> | undefined): {
  deployedBy: string;
} {
  const raw = body?.deployment;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { deployedBy: '' };
  }
  const deployedBy = String((raw as Record<string, unknown>).deployedBy ?? '').trim();
  return { deployedBy };
}

export function useDeploymentData() {
  const [mode, setMode] = useState<CurrentModeData>(FALLBACK_MODE);
  const [stats, setStats] = useState<DataStatsData>(FALLBACK_STATS);
  const [schedule, setSchedule] = useState<ExecutingScheduleData>(FALLBACK_SCHEDULE);
  const [event, setEvent] = useState<MajorEventData>(FALLBACK_EVENT);
  const [vehicles, setVehicles] = useState<string[]>(FALLBACK_VEHICLES);
  const [mainline, setMainline] = useState<ShiftRow[]>(FALLBACK_MAINLINE);
  const [maintenance, setMaintenance] = useState<ShiftRow[]>(FALLBACK_MAINTENANCE);
  const [dispatchEnabled, setDispatchEnabledState] = useState<boolean | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [modeRows, statsRows, scheduleRows, eventRows, vehicleRows, mainRows, maintRows, dispatchEnabledValue] =
        await Promise.all([
          querySql(DEPLOYMENT_CURRENT_MODE_SQL),
          querySql(DEPLOYMENT_DATA_STATS_SQL),
          querySql(DEPLOYMENT_EXECUTING_SCHEDULE_SQL),
          querySql(DEPLOYMENT_MAJOR_EVENTS_SQL),
          querySql(DEPLOYMENT_VEHICLE_LIST_SQL),
          querySql(MAINLINE_SHIFTS_SQL),
          querySql(MAINTENANCE_SHIFTS_SQL),
          fetchDispatchEnabled(),
        ]);
      if (cancelled) return;
      setDispatchEnabledState(dispatchEnabledValue);

      const modeRow = modeRows[0];
      if (modeRow) {
        setMode({
          modeLabel: str(modeRow, 'mode_label', FALLBACK_MODE.modeLabel),
          modeLevel: str(modeRow, 'mode_level', FALLBACK_MODE.modeLevel),
        });
      }

      const statsRow = statsRows[0];
      if (statsRow) {
        setStats({
          ontimePct: num(statsRow, 'ontime_pct', FALLBACK_STATS.ontimePct),
          achievementPct: num(statsRow, 'achievement_pct', FALLBACK_STATS.achievementPct),
          totalCount: num(statsRow, 'total_count', FALLBACK_STATS.totalCount),
          completedCount: num(statsRow, 'completed_count', FALLBACK_STATS.completedCount),
          delayedCount: num(statsRow, 'delayed_count', FALLBACK_STATS.delayedCount),
          abnormalCount: num(statsRow, 'abnormal_count', FALLBACK_STATS.abnormalCount),
          cancelledCount: num(statsRow, 'cancelled_count', FALLBACK_STATS.cancelledCount),
        });
      }

      const scheduleRow = scheduleRows[0];
      const periods = [
        str(scheduleRow, 'period_1', FALLBACK_SCHEDULE.periods[0]),
        str(scheduleRow, 'period_2', FALLBACK_SCHEDULE.periods[1]),
        str(scheduleRow, 'period_3', FALLBACK_SCHEDULE.periods[2]),
      ];
      let nextSchedule: ExecutingScheduleData = {
        ...FALLBACK_SCHEDULE,
        ...(scheduleRow
          ? {
              scheduleMeta: str(scheduleRow, 'schedule_meta', FALLBACK_SCHEDULE.scheduleMeta),
              statusLabel: str(scheduleRow, 'status_label', FALLBACK_SCHEDULE.statusLabel),
              scheduleName: str(scheduleRow, 'schedule_name', FALLBACK_SCHEDULE.scheduleName),
              reviewerName: str(scheduleRow, 'reviewer_name', FALLBACK_SCHEDULE.reviewerName),
              periods,
            }
          : {}),
        pending: false,
      };

      try {
        const inUse = await fetchOperationShiftList({
          usage_status: 'in_use',
          page: 1,
          page_size: 1,
        });
        const deployed = inUse.items[0];
        if (deployed) {
          let deployedBy = '';
          try {
            const detail = await fetchOperationShiftDetail(deployed.shift_id);
            deployedBy = readDeploymentMeta(detail.body).deployedBy;
          } catch {
            // keep empty reviewer
          }
          nextSchedule = {
            ...nextSchedule,
            scheduleMeta: '當前班表 使用中',
            statusLabel: '進行中',
            scheduleName: deployed.name,
            reviewerName: deployedBy || nextSchedule.reviewerName,
            pending: false,
          };
        }
      } catch {
        // keep SQL / fallback executing card
      }

      /**
       * 待核准請求要<strong>先跟後端對過</strong>再讀。
       *
       * 送出申請的排班人員與核准的主管通常不是同一台電腦；只讀本機快取的話，主管
       * 這一端永遠看不到別人送出的申請。拉不到就沿用快取，畫面不會因為後端暫時
       * 不可用而空掉。
       */
      await refreshPendingScheduleAdjust();
      const pending = readPendingScheduleAdjust();
      if (pending) {
        nextSchedule = {
          ...nextSchedule,
          scheduleMeta: `待核准 · 申請調整為 ${pending.shiftName || pending.shiftId}`,
          statusLabel: '待核准',
          reviewerName: pending.submittedBy || nextSchedule.reviewerName,
          pending: true,
        };
      }
      if (!cancelled) setSchedule(nextSchedule);

      const eventRow = eventRows[0];
      if (eventRow) {
        setEvent({
          title: str(eventRow, 'event_title', FALLBACK_EVENT.title),
          level: str(eventRow, 'event_level', FALLBACK_EVENT.level),
          date: str(eventRow, 'event_date', FALLBACK_EVENT.date),
          time: str(eventRow, 'event_time', FALLBACK_EVENT.time),
        });
      }

      const codes = vehicleRows
        .map((row) => str(row, 'vehicle_code'))
        .filter(Boolean);
      if (codes.length > 0) setVehicles(codes);

      if (mainRows.length > 0) setMainline(mainRows.map(mapShiftRow));
      if (maintRows.length > 0) setMaintenance(maintRows.map(mapShiftRow));
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  /*
   * 班次清單跟著後端即時變：車端 MQTT 換單、到站換段、狀態或延誤改變時，後端寫庫後推
   * datasource/invalidate（mqtt.service.ts → emitOrderLifecycle，最多每秒一次）。收到就只重查
   * 清單與統計，不重拉班表、待核准那些慢資料。查詢中又來通知就排一次補查，不疊、不丟。
   * 進度條本身不靠重查：ShiftRouteTrack 直接吃車隊 MQTT。
   */
  const liveRef = useRef({ running: false, again: false, timer: 0, lastAt: 0 });
  useEffect(() => {
    let disposed = false;
    const live = liveRef.current;
    const run = async () => {
      if (live.running) {
        live.again = true;
        return;
      }
      live.running = true;
      live.lastAt = Date.now();
      try {
        const [statsRows, mainRows, maintRows] = await Promise.all([
          querySql(DEPLOYMENT_DATA_STATS_SQL),
          querySql(MAINLINE_SHIFTS_SQL),
          querySql(MAINTENANCE_SHIFTS_SQL),
        ]);
        if (disposed) return;
        const statsRow = statsRows[0];
        if (statsRow) {
          setStats({
            ontimePct: num(statsRow, 'ontime_pct', FALLBACK_STATS.ontimePct),
            achievementPct: num(statsRow, 'achievement_pct', FALLBACK_STATS.achievementPct),
            totalCount: num(statsRow, 'total_count', FALLBACK_STATS.totalCount),
            completedCount: num(statsRow, 'completed_count', FALLBACK_STATS.completedCount),
            delayedCount: num(statsRow, 'delayed_count', FALLBACK_STATS.delayedCount),
            abnormalCount: num(statsRow, 'abnormal_count', FALLBACK_STATS.abnormalCount),
            cancelledCount: num(statsRow, 'cancelled_count', FALLBACK_STATS.cancelledCount),
          });
        }
        setMainline(mainRows.map(mapShiftRow));
        setMaintenance(maintRows.map(mapShiftRow));
      } finally {
        live.running = false;
        if (live.again && !disposed) {
          live.again = false;
          schedule();
        }
      }
    };
    const schedule = () => {
      if (live.timer) return;
      const wait = Math.max(0, LIVE_MIN_GAP_MS - (Date.now() - live.lastAt));
      live.timer = window.setTimeout(() => {
        live.timer = 0;
        void run();
      }, wait);
    };
    const unsubscribe = subscribeDatasourceInvalidation((payload) => {
      if (payload.tags.some((tag) => LIVE_TAGS.has(tag))) schedule();
    });
    return () => {
      disposed = true;
      unsubscribe();
      if (live.timer) window.clearTimeout(live.timer);
      live.timer = 0;
    };
  }, []);

  return { mode, stats, schedule, event, vehicles, mainline, maintenance, dispatchEnabled, reload };
}
