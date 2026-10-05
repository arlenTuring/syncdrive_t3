import type { TimetableTripDto } from '../operation-shift/timetable/expand-timetable';
import type { YardMove } from './dispatch.yard-moves';
import type { YardTask } from './dispatch.yard-tasks';

/**
 * 把班表班次換算成「今天要下的訂單」——不碰資料庫、不碰時鐘以外的東西，
 * 所以可以單獨測試。
 *
 * 班表的時刻是<strong>當日第幾秒</strong>（可以超過 86400，那是跨午夜的班次）；
 * 訂單要的是<strong>絕對時刻</strong>。轉換一定要經過「當地零點」，不能拿秒數
 * 直接格式化——那樣跨午夜的班次會落在錯誤的日期上。
 */

/**
 * 一班待下的訂單。
 *
 * 兩種來源共用同一個型別：載客班次與空車移動。對車輛來說兩者沒有差別——都是
 * 「幾點從 A 開到 B」。差別只在 <code>stations</code>：載客班次有中途站，空車
 * 移動沒有。
 */
export type PlannedDispatch = {
  /**
   * passenger＝載客班次；movement＝空車移動（出廠、入廠、讓站）；
   * maintenance＝整備班次（充電、行檢、保養、洗車、臨停、待命）
   */
  kind: 'passenger' | 'movement' | 'maintenance';
  /** 整備班次專用：格位代號與徽章。其餘種類為 null。 */
  maintenance: {
    yardSlotId: string;
    typeLabel: string;
    typeBg: string;
    typeColor: string;
    /** 班表卡原本的任務類型（charging…）；車端靠它判斷作業內容，不看卡片文字 */
    taskType: string;
    /** 充電作業參數；只有充電卡才有，其餘為 null */
    charging: ChargingSpec | null;
  } | null;
  /** 協議 §三：[YYMMDD]-[trip_code] */
  orderId: string;
  tripCode: string;
  vehicleCode: string;
  timelineRow: number;
  taskType: string;
  cardLabel: string;
  routeCode: string | null;
  routeName: string | null;
  /** 絕對發車時刻（Epoch 毫秒） */
  departAt: number;
  /** 絕對結束時刻（Epoch 毫秒） */
  arriveAt: number;
  /** 起點（A 點） */
  origin: DispatchPoint | null;
  /** 終點（B 點） */
  destination: DispatchPoint | null;
  /** 完整站序，含各站計畫時刻。空車移動為空陣列。 */
  stations: DispatchStation[];
  /**
   * 過渡任務的用途與設施（卡片短名稱用：出廠 E3、入廠 D2、待命 D3、暫停 D1）。
   * 來自班表卡的結構化欄位（空車移動的方向、整備卡的任務類型），不看卡片文字或任務代號。
   */
  transitionPurpose?: 'yard_exit' | 'yard_entry' | 'standby' | 'hold' | null;
  transitionFacility?: string | null;
};

/**
 * 充電作業參數，取自班表綁定的整備任務（充電步驟的設備列與上限）。
 *
 * 設定缺漏時仍然下單（整備佔格位照常），但把原因寫進 <code>error</code>，
 * 車端看到就明確回報「無法充電」，不自己猜一個速率。
 */
export type ChargingSpec = {
  equipmentCode: string;
  rateKwhPerMin: number | null;
  /** 充電上限（%）；未啟用上限偵測時為 100 */
  upperLimitPercent: number;
  maintenanceTaskId: string | null;
  error: string | null;
};

/**
 * 訂單的一端。
 *
 * <code>kind</code> 分辨這一端是站點還是場區設施節點——兩者的 id 取自不同的圖資
 * 集合，車端要照 kind 去查對應的座標。
 */
export type DispatchPoint = {
  id: string;
  name: string;
  kind: 'station' | 'facility';
  /** 絕對計畫抵達（起點為 null） */
  arriveAt: number | null;
  /** 絕對計畫離開（終點為 null） */
  departAt: number | null;
};

export type DispatchStation = {
  order: number;
  stationId: string;
  stationName: string;
  role: string;
  /** 絕對計畫抵達（起站為 null） */
  arriveAt: number | null;
  /** 絕對計畫離站（末站為 null） */
  departAt: number | null;
  dwellSeconds: number;
};

/** 當地零點。班表秒數要落到絕對時刻時的基準。 */
export function localMidnight(reference: number): number {
  const date = new Date(reference);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 協議 §三 的 order_id：YYMMDD-tripCode，日期取<strong>發車日</strong> */
export function buildOrderId(tripCode: string, departAt: number): string {
  const date = new Date(departAt);
  const yy = String(date.getFullYear() % 100).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}-${tripCode}`;
}

/**
 * 時間線列 → 車輛代號。
 *
 * <strong>目前是固定對應</strong>：第 N 列由 PMS0N 擔任。這是「完美情境」的假設
 * ——不考慮保養到期、電量、故障。真正的每日綁定是即時調度引擎的下一階段，屆時
 * 這個函式會換成查詢當日綁定表，其餘邏輯不必動（見
 * document/架構與設計/即時調度引擎-架構草案.md）。
 *
 * 列號超出車隊時回 null，那一班不下訂單並記錄——寧可少一班，也不要把兩列的
 * 訂單都指派給同一台車。
 */
export function vehicleForRow(
  row: number,
  fleet: readonly string[],
): string | null {
  if (!Number.isInteger(row) || row < 1) return null;
  return fleet[row - 1] ?? null;
}

function toStation(
  station: TimetableTripDto['stations'][number],
  midnight: number,
): DispatchStation {
  const at = (second: number | null | undefined): number | null =>
    second == null ? null : midnight + Math.round(second) * 1000;
  // 班次卡的站點時刻在展開結果裡是 HH:MM:SS 字串，秒數要自己換算
  const toSecond = (clock: string | null): number | null => {
    if (!clock) return null;
    const [h, m, sec] = clock.split(':').map((part) => Number(part));
    if ([h, m, sec].some((value) => !Number.isFinite(value))) return null;
    return h * 3600 + m * 60 + sec;
  };
  return {
    order: station.order,
    stationId: station.station_id,
    stationName: station.station_name,
    role: station.role,
    arriveAt: at(toSecond(station.arrival)),
    // 末站沒有 departure，改用 dwell_complete（靠站完成＝卡結束）
    departAt: at(toSecond(station.departure ?? station.dwell_complete)),
    dwellSeconds: station.dwell_seconds,
  };
}

/**
 * 展開成當日的待下訂單清單。
 *
 * <code>reference</code> 是「今天是哪一天」的判定基準，通常就是現在時刻。
 */
export function planDispatches(args: {
  trips: TimetableTripDto[];
  fleet: readonly string[];
  taskTypes: string[];
  reference: number;
}): {
  planned: PlannedDispatch[];
  skipped: Array<{ tripCode: string; reason: string }>;
} {
  const { trips, fleet, taskTypes, reference } = args;
  const midnight = localMidnight(reference);
  const wanted = new Set(taskTypes);

  const planned: PlannedDispatch[] = [];
  const skipped: Array<{ tripCode: string; reason: string }> = [];

  for (const trip of trips) {
    if (!wanted.has(trip.task_type)) continue;

    const vehicleCode = vehicleForRow(trip.timeline_row, fleet);
    if (!vehicleCode) {
      skipped.push({
        tripCode: trip.trip_code,
        reason: `時間線第 ${trip.timeline_row} 列沒有對應車輛（車隊只有 ${fleet.length} 台）`,
      });
      continue;
    }

    const departAt = midnight + Math.round(trip.card_start_second) * 1000;
    const stations = trip.stations.map((station) =>
      toStation(station, midnight),
    );
    const first = stations[0];
    const last = stations[stations.length - 1];

    planned.push({
      kind: 'passenger',
      maintenance: null,
      orderId: buildOrderId(trip.trip_code, departAt),
      tripCode: trip.trip_code,
      vehicleCode,
      timelineRow: trip.timeline_row,
      taskType: trip.task_type,
      cardLabel: trip.card_label,
      routeCode: trip.route_code,
      routeName: trip.route_name,
      departAt,
      arriveAt: midnight + Math.round(trip.card_end_second) * 1000,
      origin: first
        ? {
            id: first.stationId,
            name: first.stationName,
            kind: 'station',
            arriveAt: first.arriveAt,
            departAt: first.departAt,
          }
        : null,
      destination: last
        ? {
            id: last.stationId,
            name: last.stationName,
            kind: 'station',
            arriveAt: last.arriveAt,
            departAt: last.departAt,
          }
        : null,
      stations,
    });
  }

  planned.sort((a, b) => a.departAt - b.departAt);
  return { planned, skipped };
}

/**
 * 空車移動換算成待下訂單。
 *
 * 與載客班次的差別只有兩點：時刻的來源是<strong>分鐘</strong>而不是秒，以及沒有
 * 中途站。其餘（車輛指派、order_id、跨午夜換算）走同一套規則，所以兩種訂單在車端
 * 看起來是一致的。
 */
export function planYardMoves(args: {
  moves: YardMove[];
  fleet: readonly string[];
  reference: number;
}): {
  planned: PlannedDispatch[];
  skipped: Array<{ tripCode: string; reason: string }>;
} {
  const { moves, fleet, reference } = args;
  const midnight = localMidnight(reference);

  const planned: PlannedDispatch[] = [];
  const skipped: Array<{ tripCode: string; reason: string }> = [];

  for (const move of moves) {
    const vehicleCode = vehicleForRow(move.timelineRow, fleet);
    if (!vehicleCode) {
      skipped.push({
        tripCode: move.tripCode,
        reason: `時間線第 ${move.timelineRow} 列沒有對應車輛（車隊只有 ${fleet.length} 台）`,
      });
      continue;
    }

    const departAt = midnight + Math.round(move.startMinute * 60) * 1000;
    const arriveAt = midnight + Math.round(move.endMinute * 60) * 1000;

    // 空車移動也算整備班次。
    //
    // 只有載客班次進正線班表，其餘一律歸整備——出廠、入廠、讓站移動都是把車
    // 在場區之間挪位置，車還沒開始營運。徽章固定「調度」（移動中），格位取
    // <strong>場區那一端</strong>：出廠時是起點、入廠時是終點。
    const yardEnd =
      move.origin?.kind === 'facility' ? move.origin : move.destination;
    const yardSlotId =
      yardEnd?.kind === 'facility' ? yardEnd.name.toUpperCase() : '';

    planned.push({
      kind: 'movement',
      maintenance: {
        yardSlotId,
        typeLabel: '調度',
        typeBg: '#422006',
        typeColor: '#FD9A00',
        taskType: 'dispatch',
        charging: null,
      },
      orderId: buildOrderId(move.tripCode, departAt),
      tripCode: move.tripCode,
      vehicleCode,
      timelineRow: move.timelineRow,
      taskType: 'dispatch',
      cardLabel: move.label || '調度',
      routeCode: null,
      routeName: move.label,
      transitionPurpose: move.direction === 'exit' ? 'yard_exit' : 'yard_entry',
      // 設施那一端：出廠是起點、入廠是終點（讓站移動只記了設施端，也在這裡）
      transitionFacility: (move.direction === 'exit' ? move.origin : move.destination)?.name ?? null,
      departAt,
      arriveAt,
      origin: move.origin ? { ...move.origin, arriveAt: null, departAt } : null,
      destination: move.destination
        ? { ...move.destination, arriveAt, departAt: null }
        : null,
      stations: [],
    });
  }

  planned.sort((a, b) => a.departAt - b.departAt);
  return { planned, skipped };
}

/**
 * 整備班次換算成待下訂單。
 *
 * 與另外兩種的差別是<strong>沒有位移</strong>：起訖點是同一個格位。車輛在整備
 * 期間就停在那裡，訂單的意義不是「開去哪」而是「這段時間這台車佔著這一格、
 * 在做這件事」——整備分佈與車輛徽章都靠這一筆。
 */
export function planYardTasks(args: {
  tasks: YardTask[];
  fleet: readonly string[];
  reference: number;
  /** 依格位代號查充電參數；呼叫端從班表綁定的整備任務建好 */
  chargingFor?: (yardSlotId: string) => ChargingSpec;
}): {
  planned: PlannedDispatch[];
  skipped: Array<{ tripCode: string; reason: string }>;
} {
  const { tasks, fleet, reference, chargingFor } = args;
  const midnight = localMidnight(reference);

  const planned: PlannedDispatch[] = [];
  const skipped: Array<{ tripCode: string; reason: string }> = [];

  for (const task of tasks) {
    const vehicleCode = vehicleForRow(task.timelineRow, fleet);
    if (!vehicleCode) {
      skipped.push({
        tripCode: task.tripCode,
        reason: `時間線第 ${task.timelineRow} 列沒有對應車輛（車隊只有 ${fleet.length} 台）`,
      });
      continue;
    }

    const departAt = midnight + Math.round(task.startMinute * 60) * 1000;
    const arriveAt = midnight + Math.round(task.endMinute * 60) * 1000;
    const point = {
      id: task.facilityNodeId,
      name: task.yardSlotId,
      kind: 'facility' as const,
    };

    planned.push({
      kind: 'maintenance',
      maintenance: {
        yardSlotId: task.yardSlotId,
        typeLabel: task.maintTypeLabel,
        typeBg: task.maintTypeBg,
        typeColor: task.maintTypeColor,
        taskType: task.taskType,
        charging: task.taskType === 'charging'
          ? chargingFor?.(task.yardSlotId) ?? {
              equipmentCode: task.yardSlotId,
              rateKwhPerMin: null,
              upperLimitPercent: 100,
              maintenanceTaskId: null,
              error: '調度引擎沒有提供充電參數',
            }
          : null,
      },
      orderId: buildOrderId(task.tripCode, departAt),
      tripCode: task.tripCode,
      vehicleCode,
      timelineRow: task.timelineRow,
      taskType: 'maintenance',
      cardLabel: task.cardLabel,
      routeCode: null,
      routeName: task.cardLabel,
      // 待命、暫停（含暫停放、提早進廠等待）是過渡；其他整備任務沒有過渡用途
      transitionPurpose: task.taskType === 'standby' ? 'standby' : task.taskType === 'idle' ? 'hold' : null,
      transitionFacility: task.yardSlotId,
      departAt,
      arriveAt,
      origin: { ...point, arriveAt: null, departAt },
      destination: { ...point, arriveAt, departAt: null },
      stations: [],
    });
  }

  planned.sort((a, b) => a.departAt - b.departAt);
  return { planned, skipped };
}

/**
 * 補齊只記了一端的移動卡。
 *
 * 「讓站移動」只寫了要去哪個設施，沒寫從哪來——因為那是<strong>同一台車上一張卡
 * 的終點</strong>。這裡就照這個事實補：同一列依時間排好，缺起點的往前拿，缺終點的
 * 往後拿。
 *
 * 補不到的（例如當天第一張卡就缺起點）維持 null，由呼叫端決定要不要發——寧可不發，
 * 也不要給車輛一個只有半邊的任務。
 */
export function fillMissingEndpoints(
  planned: PlannedDispatch[],
): PlannedDispatch[] {
  const byRow = new Map<number, PlannedDispatch[]>();
  for (const item of planned) {
    const list = byRow.get(item.timelineRow) ?? [];
    list.push(item);
    byRow.set(item.timelineRow, list);
  }

  for (const list of byRow.values()) {
    list.sort((a, b) => a.departAt - b.departAt);
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i];
      if (!item.origin) {
        const previous = list[i - 1];
        if (previous?.destination) {
          item.origin = {
            ...previous.destination,
            arriveAt: null,
            departAt: item.departAt,
          };
        }
      }
      if (!item.destination) {
        const next = list[i + 1];
        if (next?.origin) {
          item.destination = {
            ...next.origin,
            arriveAt: item.arriveAt,
            departAt: null,
          };
        }
      }
    }
  }

  return planned;
}

/**
 * 這一班現在該下訂單了嗎。
 *
 * 三種情況：
 * <ul>
 *   <li>還沒到提前量 → 等</li>
 *   <li>在提前量之內、或已經過了但還在補發窗口 → 下</li>
 *   <li>過太久 → 放棄。那已經不是「晚一點出發」而是「這班不用跑了」</li>
 * </ul>
 */
export function dispatchDecision(args: {
  departAt: number;
  now: number;
  leadSeconds: number;
  catchUpSeconds: number;
}): 'wait' | 'dispatch' | 'expired' {
  const { departAt, now, leadSeconds, catchUpSeconds } = args;
  const lead = departAt - now;
  if (lead > leadSeconds * 1000) return 'wait';
  if (lead < -catchUpSeconds * 1000) return 'expired';
  return 'dispatch';
}
