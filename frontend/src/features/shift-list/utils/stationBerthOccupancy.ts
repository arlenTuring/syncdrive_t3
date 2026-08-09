import type { ShiftScheduleSelectedRoute } from '../types/create';
import {
  buildBlockStationDepartures,
  resolveRouteForBlock,
} from './buildBlockStationDepartures';
import type { GeneratedSchedulePlan } from './schedule-engine/types';
import { minuteToSecond } from './schedule-engine/types';
import {
  isStationDwellRequired,
  looksLikeDefaultCrossoverPortalStationId,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
} from './schedule-engine/physics';
import {
  resolveLeaveMarginSeconds,
  resolveRouteClearanceInsertGapSeconds,
} from './stationClearanceInsert';
import { resolveEffectiveRouteTravelSeconds } from './stationLegTravel';

/**
 * 同一列（同一台車）在這個區塊之後，下一個任務幾分鐘開始。
 * <strong>沒有下一個任務就回傳 null</strong>——當天沒排定的事就不假設，
 * 不去猜「這台車會一直停到某個時間點」，只在真的有排定的空檔時才視為佔用。
 *
 * 這是「站位碰撞」判定裡容易漏掉的一塊：一個區塊自己的 <code>plannedEndMinute</code>
 * 只代表「這個排班動作結束」，不代表「車子離開了這個站」。車子到站之後，
 * 如果下一個任務要等很久才開始，車子其實還停在原地——這段時間站位仍然被佔用。
 */
export function resolveSameRowNextBlockStartMinute(
  timelines: GeneratedSchedulePlan['timelines'],
  block: { id: string; timelineRow: number; plannedEndMinute: number },
): number | null {
  const row = timelines.find((t) => t.row === block.timelineRow);
  if (!row) return null;
  let next: number | null = null;
  for (const other of row.blocks) {
    if (other.id === block.id) continue;
    if (other.plannedStartMinute + 1e-9 < block.plannedEndMinute) continue;
    if (next == null || other.plannedStartMinute < next) next = other.plannedStartMinute;
  }
  return next;
}

/**
 * 這個間隔要超過多久才算「車子真的在原地閒置等待」，不是正常換線／恢復的落差。
 * 同站折返（下行接上行）中間常有幾秒到幾十秒的換線空檔，那不是閒置，是正常接續，
 * 不該被算進站位佔用；只有明顯偏長的落差（例如車子要等好幾分鐘才排下一個任務）
 * 才代表車子確實還停在原地佔著站位。
 */
export const MEANINGFUL_IDLE_GAP_SECONDS = 60;

/**
 * 同一列在這個區塊之後，是否真的有一段「閒置等待」的空檔（超過
 * {@link MEANINGFUL_IDLE_GAP_SECONDS}）；有則回傳下一個任務的開始分鐘，
 * 否則回傳 null（正常換線接續，不視為站位延伸佔用）。
 */
export function resolveSameRowIdleOccupiedUntilMinute(
  timelines: GeneratedSchedulePlan['timelines'],
  block: { id: string; timelineRow: number; plannedEndMinute: number },
): number | null {
  const nextStart = resolveSameRowNextBlockStartMinute(timelines, block);
  if (nextStart == null) return null;
  const idleGapSeconds = (nextStart - block.plannedEndMinute) * 60;
  if (idleGapSeconds <= MEANINGFUL_IDLE_GAP_SECONDS) return null;
  return nextStart;
}

export type StationBerthOccupancy = {
  stationId: string;
  stationName: string;
  timelineRow: number;
  blockId: string;
  routeCode: string | null;
  routeId: string | null;
  /** 到站（分鐘） */
  startMinute: number;
  /** 離站／可出發（分鐘）＝該站自然在站時間結束 */
  endMinute: number;
  /**
   * 這個佔用所屬<strong>班次卡</strong>的起訖（分鐘）。
   *
   * 跟 startMinute／endMinute 是兩回事：後者是「在這一站佔著站位的那幾秒」，
   * 常常只有 10 秒；班次卡上顯示的是整趟的起訖。回報訊息一定要用班次卡的時間，
   * 否則使用者拿訊息去對畫面會對不起來（2026-08-08 踩過）。
   */
  blockStartMinute: number;
  blockEndMinute: number;
  /**
   * 這台車<strong>真正開走</strong>的時刻（分鐘）＝ 自然離站，含末站滯留。
   * 沒開啟碰撞保護時就等於 {@link endMinute}。
   */
  actualDepartMinute: number;
  /**
   * <strong>站位淨空</strong>的時刻（分鐘）＝ 實際離站 + 1 × 碰撞保護時間。
   * 這一刻起這台車已經駛離會互撞的那段空間，站位真的空出來了。
   */
  berthClearMinute: number;
  /**
   * <strong>別台車最早可以到站</strong>的時刻（分鐘）＝ 實際離站 + 2 × 碰撞保護時間。
   *
   * 為什麼是兩倍：站位在 {@link berthClearMinute} 就空了，但後車也要花同樣的時間
   * 才能從那段空間的外緣開進站位。所以「站位空出來的時刻」與
   * 「別台車最早可以到的時刻」是兩個不同的數字，回報時不要混用
   * ——寫成「站位要到某某時刻才讓出來」是錯的（2026-08-08 使用者指正）。
   *
   * 顯示訊息一律用 startMinute／endMinute（班次卡看得到的）；這個欄位只拿來判定碰撞。
   */
  protectedUntilMinute: number;
};

export type StationBerthCollisionKind =
  /** 兩台車的到離站區間真的重疊——同一時刻兩台車都在站位上 */
  | 'overlap'
  /**
   * 區間沒重疊，但後車進站太貼著前車離站，不滿足
   * 「後車到站 ≥ 前車實際離站 + 2 × 碰撞保護時間」。
   */
  | 'protection_gap';

export type StationBerthCollision = {
  stationId: string;
  stationName: string;
  kind: StationBerthCollisionKind;
  earlier: StationBerthOccupancy;
  later: StationBerthOccupancy;
  overlapSeconds: number;
  /** 後車進站與前車離站的間距（秒）；重疊時為負 */
  clearanceGapSeconds: number;
  requiredClearanceSeconds: number;
  /** 還差幾秒才滿足碰撞保護（kind='protection_gap' 時 > 0） */
  protectionShortfallSeconds: number;
};

/**
 * 蒐集各停靠點跨車在站區間。
 *
 * 佔用＝該班在該站「到站～離站」的自然時間（還沒出發前本來就在這個空間），
 * **不是**正線結束後把充電／保養／行檢／待命硬掛在末站上。
 */
export function collectStationBerthOccupancies(
  timelines: GeneratedSchedulePlan['timelines'],
  selectedRoutes: ShiftScheduleSelectedRoute[],
  /**
   * 碰撞保護設定。不給、給 null、或秒數 ≤ 0 ＝完全關閉：只判定到離站區間重疊，
   * 末站滯留與碰撞保護時間都不計入，等同 2026-08-07 之前的行為。
   */
  protection?: { collisionProtectionSeconds: number } | null,
): StationBerthOccupancy[] {
  const out: StationBerthOccupancy[] = [];
  const minPresenceMin = SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS / 60;
  const protectionOn = (protection?.collisionProtectionSeconds ?? 0) > 0;
  const protectionMin = protectionOn
    ? (protection!.collisionProtectionSeconds * 2) / 60
    : 0;

  for (const timeline of timelines) {
    const blocks = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );

    for (const block of blocks) {
      if (block.taskType !== 'passenger') continue;
      const route = resolveRouteForBlock(block, selectedRoutes);
      if (!route) continue;
      const stops = buildBlockStationDepartures(block, route);
      if (stops.length === 0) continue;

      for (let si = 0; si < stops.length; si += 1) {
        const stop = stops[si]!;
        const dwellMeta = route.stationDwells.find((d) => d.stationId === stop.stationId);
        const isPortal =
          looksLikeDefaultCrossoverPortalStationId(stop.stationId)
          || (dwellMeta != null && !isStationDwellRequired(dwellMeta));
        const isTerminal = si === stops.length - 1;
        const isOrigin = si === 0;

        let startMinute = stop.arrivalMinute;
        let endMinute = Math.max(stop.departureMinute, stop.arrivalMinute);

        // 途經／虛擬渡線且無實際停靠秒：不參與站位碰撞
        if (isPortal && !isOrigin && !isTerminal && stop.dwellSeconds <= 0) {
          continue;
        }

        // 有靠站秒數卻退化成點：補最小在站；純起終 0 秒也給一格，避免同秒進出漏判
        if (endMinute <= startMinute + 1e-12) {
          if (stop.dwellSeconds > 0 || isOrigin || isTerminal) {
            endMinute = startMinute + minPresenceMin;
          } else {
            continue;
          }
        }

        // 別台車最早可以進來的時刻。兩塊各自獨立：
        // 1) 末站滯留——這一趟跑完後車還停在原地等下一個任務，站位一直被佔著。
        //    只有末站會滯留（車開過中間站不會停在那裡等）。
        // 2) 碰撞保護時間 ×2——A 車駛離衝突區要一份，B 車開進來要另一份。
        let actualDepartMinute = endMinute;
        if (protectionOn && isTerminal) {
          const idleUntil = resolveSameRowIdleOccupiedUntilMinute(timelines, block);
          if (idleUntil != null) {
            actualDepartMinute = Math.max(actualDepartMinute, idleUntil);
          }
        }
        // 站位淨空 = 實際離站 + 1 × 保護時間（車已駛離互撞路段）
        // 別台車最早可到 = 實際離站 + 2 × 保護時間（後車也要開進來）
        const berthClearMinute = actualDepartMinute + protectionMin / 2;
        const protectedUntilMinute = actualDepartMinute + protectionMin;

        out.push({
          stationId: stop.stationId,
          stationName: stop.stationName,
          timelineRow: timeline.row,
          blockId: block.id,
          routeCode: block.routeCode ?? route.routeCode ?? null,
          routeId: block.routeId ?? route.routeId,
          startMinute,
          endMinute,
          blockStartMinute: block.plannedStartMinute,
          blockEndMinute: block.plannedEndMinute,
          actualDepartMinute,
          berthClearMinute,
          protectedUntilMinute,
        });
      }
    }
  }

  return out;
}

function requiredClearanceSecondsForStation(
  stationId: string,
  selectedRoutes: ShiftScheduleSelectedRoute[],
): number {
  for (const route of selectedRoutes) {
    const onRoute =
      route.stationIds?.includes(stationId)
      || route.stationDwells?.some((d) => d.stationId === stationId);
    if (!onRoute) continue;
    return resolveRouteClearanceInsertGapSeconds(
      route,
      resolveEffectiveRouteTravelSeconds(route),
      stationId,
    );
  }
  return Math.max(
    SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
    resolveLeaveMarginSeconds({}),
  );
}

/**
 * 不同車在同一停靠點的「到站～離站」區間不得重疊。
 */
export function findStationBerthCollisions(
  occupancies: StationBerthOccupancy[],
  selectedRoutes: ShiftScheduleSelectedRoute[],
): StationBerthCollision[] {
  const byStation = new Map<string, StationBerthOccupancy[]>();
  for (const occ of occupancies) {
    const list = byStation.get(occ.stationId) ?? [];
    list.push(occ);
    byStation.set(occ.stationId, list);
  }

  const collisions: StationBerthCollision[] = [];
  for (const [, list] of byStation) {
    const sorted = [...list].sort((a, b) => a.startMinute - b.startMinute);
    const required = requiredClearanceSecondsForStation(
      sorted[0]!.stationId,
      selectedRoutes,
    );
    const requiredMin = required / 60;

    for (let i = 0; i < sorted.length; i += 1) {
      const earlier = sorted[i]!;
      for (let j = i + 1; j < sorted.length; j += 1) {
        const later = sorted[j]!;
        if (later.timelineRow === earlier.timelineRow) continue;
        // 已排序，後面的只會更晚：一旦連碰撞保護都清得開就不必再往後看
        const protectedFloor = Math.max(
          earlier.endMinute + requiredMin,
          earlier.protectedUntilMinute,
        );
        if (later.startMinute >= protectedFloor - 1e-12) break;

        const overlapMin =
          Math.min(earlier.endMinute, later.endMinute)
          - Math.max(earlier.startMinute, later.startMinute);
        const shortfallMin = Math.max(
          0,
          earlier.protectedUntilMinute - later.startMinute,
        );
        // requiredClearance 只用來決定要不要繼續往後看，本身不構成碰撞
        // （2026-08-07 之前就是這樣，這裡不改）。真正會回報的只有兩種：
        // 區間重疊，或不滿足碰撞保護。
        if (overlapMin <= 1e-9 && shortfallMin <= 1e-9) continue;
        const kind: StationBerthCollisionKind =
          overlapMin > 1e-9 ? 'overlap' : 'protection_gap';

        collisions.push({
          stationId: earlier.stationId,
          stationName: earlier.stationName,
          kind,
          earlier,
          later,
          overlapSeconds: minuteToSecond(Math.max(0, overlapMin)),
          clearanceGapSeconds: minuteToSecond(later.startMinute - earlier.endMinute),
          requiredClearanceSeconds: required,
          protectionShortfallSeconds: minuteToSecond(shortfallMin),
        });
      }
    }
  }

  return collisions;
}
