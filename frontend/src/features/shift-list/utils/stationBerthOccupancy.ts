import type { ShiftScheduleSelectedRoute } from '../types/create';
import {
  buildBlockStationDepartures,
  resolveRouteForBlock,
} from './buildBlockStationDepartures';
import type { GeneratedSchedulePlan } from './schedule-engine/types';
import { minuteToSecond } from './schedule-engine/types';
import {
  isStationDwellRequired,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
} from './schedule-engine/physics';
import {
  resolveLeaveMarginSeconds,
  resolveRouteClearanceInsertGapSeconds,
} from './stationClearanceInsert';
import { resolveEffectiveRouteTravelSeconds } from './stationLegTravel';
import { daySegmentOverlapSeconds } from './moveCardShared';

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
    /**
     * 暫停卡對這個掃描是<strong>透明</strong>的。
     *
     * 它記載的正是「這台車還停在原地」那段空隙本身，不是下一個任務。把它當成
     * 下一張卡的話空隙會變成 0，滯留推論整個失效——實測（2026-08-25）補上正線側
     * 暫停卡之後站位碰撞從 0 對變 1 對，就是這樣來的。跳過它之後拿到的仍然是
     * 空隙後面那張真正的卡，而暫停卡的結束時刻本來就等於那張卡的開始時刻，
     * 所以結果與補卡之前完全一致。
     */
    if (other.source === 'hold') continue;
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

/**
 * 這一段跑完之後，車停在原地待到幾分鐘——<strong>照暫停卡上寫的</strong>。
 *
 * 有卡就用卡，這是事實；沒有卡才退回 {@link resolveSameRowIdleOccupiedUntilMinute}
 * 的推論（求解過程中還沒補卡，那個階段只能推論）。差別在門檻：推論版本規定空隙要
 * 超過 {@link MEANINGFUL_IDLE_GAP_SECONDS}（60 秒）才算滯留，60 秒以下的一律當成
 * 沒發生；碰撞保護是 30 秒，一段 50 秒的滯留是真的衝突窗口，卻沒有任何人記得。
 * 有卡之後這個門檻就不需要了——卡在那裡就是車在那裡。
 */
function resolveHoldEndMinuteAfter(
  timelines: GeneratedSchedulePlan['timelines'],
  block: { id: string; timelineRow: number; plannedEndMinute: number },
  stationId: string,
): number | null {
  const row = timelines.find((t) => t.row === block.timelineRow);
  if (!row) return null;
  for (const other of row.blocks) {
    if (other.source !== 'hold') continue;
    if (Math.abs(other.plannedStartMinute - block.plannedEndMinute) > 1e-9) continue;
    if (other.yardFacilityStationId !== stationId) continue;
    return other.plannedEndMinute;
  }
  return null;
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
 * **不是**正線結束後把充電／保養／行檢硬掛在末站上（那是沒有明確地點的推測）。
 *
 * 唯一的例外是<strong>待命停在正線停靠站</strong>：那是使用者指定、引擎也挑定的
 * 明確地點，車整段時間真的停在那一格，別台車進不來、那條路線也排不了。
 * 這種佔用一定要算進來，否則排出來的班表是假的。
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
      /**
       * 暫停卡<strong>不自成一筆佔用</strong>，它餵的是末站分支的
       * <code>actualDepartMinute</code>（見下方）。
       *
       * 這裡踩過一次：把暫停登記成獨立的到離站區間，等於用兩種模型描述同一件事
       * ——系統其他地方一律把「還沒開走」記在 <code>actualDepartMinute</code>，
       * 額外再開一段區間就變成重複計算，實測（2026-08-25）四列共用一個終端站的
       * 案例因此從 ok 變成 15 筆 <code>STATION_BERTH_COLLISION</code>。
       * 暫停卡的價值在於它是<strong>事實</strong>，可以取代 60 秒門檻的推論，
       * 不在於多開一種佔用型別。
       */
      if (block.source === 'hold') continue;
      // 待命停在正線停靠站：整段時間都實實在在佔著那一格。
      // 這跟「正線跑完把整備硬掛在末站」不一樣——那是沒有明確地點的推測，
      // 這是使用者指定、引擎也挑定的地點，車真的停在那裡，別台車進不來。
      if (block.taskType === 'standby' && block.yardFacilityStationId) {
        const startMinute = block.plannedStartMinute;
        const endMinute = Math.max(block.plannedEndMinute, startMinute + minPresenceMin);
        out.push({
          stationId: block.yardFacilityStationId,
          stationName: block.yardFacilityLabel ?? block.yardFacilityStationId,
          timelineRow: timeline.row,
          blockId: block.id,
          routeCode: null,
          routeId: null,
          startMinute,
          endMinute,
          blockStartMinute: block.plannedStartMinute,
          blockEndMinute: block.plannedEndMinute,
          actualDepartMinute: endMinute,
          berthClearMinute: endMinute + protectionMin / 2,
          protectedUntilMinute: endMinute + protectionMin,
        });
        continue;
      }
      if (block.taskType !== 'passenger') continue;
      const route = resolveRouteForBlock(block, selectedRoutes);
      if (!route) continue;
      const stops = buildBlockStationDepartures(block, route);
      if (stops.length === 0) continue;

      for (let si = 0; si < stops.length; si += 1) {
        const stop = stops[si]!;
        const dwellMeta = route.stationDwells.find((d) => d.stationId === stop.stationId);
        const isPortal = dwellMeta != null && !isStationDwellRequired(dwellMeta);
        const isTerminal = si === stops.length - 1;
        const isOrigin = si === 0;

        const startMinute = stop.arrivalMinute;
        let endMinute = Math.max(stop.departureMinute, stop.arrivalMinute);

        // 途經點且無實際停靠秒：不參與站位碰撞
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
          const holdEnd = resolveHoldEndMinuteAfter(timelines, block, stop.stationId);
          const idleUntil = holdEnd ?? resolveSameRowIdleOccupiedUntilMinute(timelines, block);
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

/** 車真的停在裡面、會佔著設施格的整備任務類型（不含調度、不含暫停卡本身） */
const FACILITY_STAY_TASK_TYPES = new Set(['charging', 'servicing', 'inspection', 'standby', 'washing']);

/**
 * 同一列在這個區塊之後，是否有一段「還停在同一個設施格」的空檔——不論有沒有補過
 * 「暫停」卡都問得到答案。
 *
 * 跟 {@link resolveHoldEndMinuteAfter} 同一套判準，鑰匙從 stationId 換成
 * facilityNodeId：暫停卡已經插了就直接採用卡上的時刻（照事實），沒插就退回
 * {@link resolveSameRowIdleOccupiedUntilMinute} 的空檔推論——兩條路算出來的答案
 * 一致，求解時的候選空位檢查（補卡之前）跟最後驗證（補卡之後）才會看到同一個
 * 佔用，不會因為「暫停」卡插了沒而有兩種答案（見 {@link collectFacilityOccupancies}）。
 */
function resolveFacilityActualDepartMinute(
  timelines: GeneratedSchedulePlan['timelines'],
  block: { id: string; timelineRow: number; plannedEndMinute: number },
  facilityNodeId: string,
): number | null {
  const row = timelines.find((t) => t.row === block.timelineRow);
  if (row) {
    for (const other of row.blocks) {
      if (other.source !== 'hold') continue;
      if (Math.abs(other.plannedStartMinute - block.plannedEndMinute) > 1e-9) continue;
      if ((other.yardFacilityNodeId?.trim() ?? '') !== facilityNodeId) continue;
      return other.plannedEndMinute;
    }
  }
  return resolveSameRowIdleOccupiedUntilMinute(timelines, block);
}

export type FacilityOccupancy = {
  facilityNodeId: string;
  facilityLabel: string;
  timelineRow: number;
  blockId: string;
  label: string;
  /** 整備／停留本身的排定起訖（分鐘） */
  startMinute: number;
  endMinute: number;
  /**
   * 車真正開走的時刻（分鐘）＝整備結束後車還賴著的那段也算進去。
   * 沒有補「暫停」卡時用跟站位同一套空檔推論分析出來，不等於 {@link endMinute}
   * 也不代表有卡；見檔案頂端 {@link resolveFacilityActualDepartMinute} 的說明。
   */
  actualDepartMinute: number;
};

/**
 * 蒐集各設施格跨車的佔用區間，車真正開走前都算佔著。
 *
 * <strong>不依賴「暫停」卡是否已經補過。</strong>設施佔用先前只記
 * <code>[整備開始, 整備結束]</code>——那段推論後來搬進 fillYardHoldGaps 插的
 * 「暫停」卡才現形，但求解／候選空位檢查（見 closeYardHeadGaps）都跑在補卡
 * <strong>之前</strong>，看到的還是沒補過的窄佔用，跟最後驗證（補卡之後）用的
 * 不是同一個答案。這支兩種情況都用同一套空檔推論分析出 actualDepartMinute，
 * 補卡前後呼叫都拿到一致的結果——「暫停」卡因此只負責<strong>呈現</strong>已經
 * 分析出來的停留，不是佔用判定唯一的資料來源。
 *
 * 「暫停」卡本身（<code>source==='hold'</code>）不獨立算一筆佔用——它延伸的是
 * 前一張整備卡的佔用區間，跟站位那邊（{@link collectStationBerthOccupancies}）
 * 同一條規矩，避免兩種模型描述同一件事，重複計算。
 */
export function collectFacilityOccupancies(
  timelines: GeneratedSchedulePlan['timelines'],
): FacilityOccupancy[] {
  const out: FacilityOccupancy[] = [];
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (block.source === 'hold') continue;
      const facilityNodeId = block.yardFacilityNodeId?.trim();
      if (!facilityNodeId) continue;
      if (!FACILITY_STAY_TASK_TYPES.has(block.taskType)) continue;
      const startMinute = block.plannedStartMinute;
      const endMinute = Math.max(block.plannedEndMinute, startMinute);
      if (endMinute <= startMinute + 1e-9) continue;

      const idleUntil = resolveFacilityActualDepartMinute(timelines, block, facilityNodeId);
      const actualDepartMinute = idleUntil != null ? Math.max(endMinute, idleUntil) : endMinute;

      out.push({
        facilityNodeId,
        facilityLabel: block.yardFacilityLabel ?? facilityNodeId,
        timelineRow: timeline.row,
        blockId: block.id,
        label: block.label,
        startMinute,
        endMinute,
        actualDepartMinute,
      });
    }
  }
  return out;
}

export type FacilityOccupancyCollisionKind = 'overlap' | 'protection_gap';

export type FacilityOccupancyCollision = {
  facilityNodeId: string;
  facilityLabel: string;
  kind: FacilityOccupancyCollisionKind;
  earlier: FacilityOccupancy;
  later: FacilityOccupancy;
  overlapSeconds: number;
  /** 後車進格與前車實際離開的間距（秒）；重疊時為負 */
  gapSeconds: number;
};

/**
 * 不同車在同一設施格的佔用區間不得重疊；沒重疊但交接秒數不夠也回報（分開列出，
 * 呼叫端決定哪一種算硬錯誤——{@link validateFacilityOccupancy} 是重疊記錯誤、
 * 交接不足記警告，跟站位那邊 {@link findStationBerthCollisions} 同一套規矩）。
 *
 * <strong>跨午夜安全</strong>：用 {@link daySegmentOverlapSeconds} 逐段比對，不直接
 * 比較 start／end 的分鐘數字——同一段整備、不同呼叫端記法不一致時（見
 * {@link daySegmentOverlapSeconds} 的說明）才不會漏判或誤判。
 */
export function findFacilityOccupancyCollisions(
  occupancies: FacilityOccupancy[],
  protectionSeconds: number,
): FacilityOccupancyCollision[] {
  const byFacility = new Map<string, FacilityOccupancy[]>();
  for (const occ of occupancies) {
    byFacility.set(occ.facilityNodeId, [...(byFacility.get(occ.facilityNodeId) ?? []), occ]);
  }

  const collisions: FacilityOccupancyCollision[] = [];
  const requiredSeconds = Math.max(0, protectionSeconds) * 2;

  for (const [, list] of byFacility) {
    const sorted = [...list].sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const earlier = sorted[i]!;
        const later = sorted[j]!;
        if (earlier.timelineRow === later.timelineRow) continue;

        const overlapSeconds = daySegmentOverlapSeconds(
          minuteToSecond(earlier.startMinute),
          minuteToSecond(earlier.actualDepartMinute),
          minuteToSecond(later.startMinute),
          minuteToSecond(later.actualDepartMinute),
        );
        const gapSeconds = minuteToSecond(later.startMinute - earlier.actualDepartMinute);

        if (overlapSeconds > 1e-6) {
          collisions.push({
            facilityNodeId: earlier.facilityNodeId,
            facilityLabel: earlier.facilityLabel,
            kind: 'overlap',
            earlier,
            later,
            overlapSeconds,
            gapSeconds,
          });
        } else if (requiredSeconds > 0 && gapSeconds < requiredSeconds - 1e-6) {
          collisions.push({
            facilityNodeId: earlier.facilityNodeId,
            facilityLabel: earlier.facilityLabel,
            kind: 'protection_gap',
            earlier,
            later,
            overlapSeconds: 0,
            gapSeconds,
          });
        }
      }
    }
  }

  return collisions;
}
