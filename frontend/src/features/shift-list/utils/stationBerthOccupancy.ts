import type { ShiftScheduleSelectedRoute } from '../types/create';
import {
  buildBlockStationDepartures,
  resolveRouteForBlock,
} from './buildBlockStationDepartures';
import type { GeneratedSchedulePlan, GeneratedScheduleBlock } from './schedule-engine/types';
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
  /**
   * 佔用窗結束（分鐘）＝該站自然在站時間結束；零秒起終站會補一格最小佔用，
   * 只為了同秒進出不漏判碰撞——<strong>不是</strong>車必須多等的時刻，
   * 車何時能動看 {@link readyMinute}。
   */
  endMinute: number;
  /**
   * 車在這一站<strong>最早可以動</strong>的時刻（分鐘）＝實際停靠完成，不含為了防漏判
   * 補的最小佔用。要開去別處（讓站、進廠）時再加最低恢復時間，見
   * {@link resolveVehicleReadyMinute}。
   */
  readyMinute: number;
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

/**
 * 車跑完這一站之後，最早可以開去別處（讓站、進廠）的時刻（分鐘）。
 *
 * 實際停靠完成 ＋ 最低恢復時間，跟入廠卡的「前一段載客跑完 ＋ 最低恢復」同一條規則。
 * 別車何時能進來是另一回事（看 actualDepartMinute 與保護時間），兩者不能混用：
 * 為了防漏判補的最小佔用不是移動命令，也不能為了早點動就刪掉別人的保護窗。
 */
export function resolveVehicleReadyMinute(
  occupancy: Pick<StationBerthOccupancy, 'readyMinute'>,
  minimumRecoveryTimeSeconds: number,
): number {
  return occupancy.readyMinute + Math.max(0, minimumRecoveryTimeSeconds) / 60;
}

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
      if (block.source === 'hold') {
        // 接在載客後面的暫停由末站分支的 actualDepartMinute 吸收（上面的說明）；
        // 不是的（提早出廠到站上等、站位待命做完還沒走）沒有別人會記，自己算一筆
        const stationId = block.yardFacilityStationId?.trim();
        const extendsTrip = blocks.some(
          (other) =>
            other.taskType === 'passenger'
            && Math.abs(other.plannedEndMinute - block.plannedStartMinute) < 1e-9,
        );
        if (!stationId || extendsTrip || block.plannedEndMinute <= block.plannedStartMinute + 1e-9) {
          continue;
        }
        out.push({
          stationId,
          stationName: block.yardFacilityLabel ?? stationId,
          timelineRow: timeline.row,
          blockId: block.id,
          routeCode: null,
          routeId: null,
          startMinute: block.plannedStartMinute,
          endMinute: block.plannedEndMinute,
          readyMinute: block.plannedEndMinute,
          blockStartMinute: block.plannedStartMinute,
          blockEndMinute: block.plannedEndMinute,
          actualDepartMinute: block.plannedEndMinute,
          berthClearMinute: block.plannedEndMinute + protectionMin / 2,
          protectedUntilMinute: block.plannedEndMinute + protectionMin,
        });
        continue;
      }
      // 待命停在正線停靠站：整段時間都實實在在佔著那一格。
      // 這跟「正線跑完把整備硬掛在末站」不一樣——那是沒有明確地點的推測，
      // 這是使用者指定、引擎也挑定的地點，車真的停在那裡，別台車進不來。
      if ((block.taskType === 'standby' || (block.taskType === 'idle' && block.source === 'transition'))
        && block.yardFacilityStationId) {
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
          readyMinute: block.plannedEndMinute,
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
        const readyMinute = Math.max(stop.departureMinute, stop.arrivalMinute);
        let endMinute = readyMinute;

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
        //    只有末站會滯留（車開過中間站不會停在那裡等）。這是實體佔用，
        //    跟碰撞保護開不開無關。
        // 2) 碰撞保護時間 ×2——A 車駛離衝突區要一份，B 車開進來要另一份。
        let actualDepartMinute = endMinute;
        if (isTerminal) {
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
          readyMinute,
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
          earlier.actualDepartMinute + requiredMin,
          earlier.protectedUntilMinute,
        );
        if (later.startMinute >= protectedFloor - 1e-12) break;

        // 實體重疊看車真正開走的時刻，不是靠站結束：末站滯留期間車還在站位上
        const overlapMin =
          Math.min(earlier.actualDepartMinute, later.actualDepartMinute)
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
          clearanceGapSeconds: minuteToSecond(later.startMinute - earlier.actualDepartMinute),
          requiredClearanceSeconds: required,
          protectionShortfallSeconds: minuteToSecond(shortfallMin),
        });
      }
    }
  }

  return collisions;
}

/** 車真的停在裡面、會佔著設施格的整備任務類型 */
const FACILITY_STAY_TASK_TYPES = new Set(['charging', 'servicing', 'inspection', 'standby', 'washing']);

const DAY_SECONDS = 24 * 60 * 60;

/**
 * 這張卡代表「車停在某一個設施格裡」時，回傳那一格；否則 null。
 *
 * 除了整備／待命之外，<code>idle</code> 也算：暫停卡（<code>source 'hold'</code>）
 * 與讓站、提早進廠插的臨時停格（<code>source 'transition'</code>）都寫了明確格位，
 * 車就停在那裡。只要有格位就是事實，不看它是哪一條策略插的。
 */
export function facilityPresenceNodeId(block: GeneratedScheduleBlock): string | null {
  const nodeId = block.yardFacilityNodeId?.trim();
  if (!nodeId) return null;
  if (FACILITY_STAY_TASK_TYPES.has(block.taskType) || block.taskType === 'idle') return nodeId;
  return null;
}

export type FacilityOccupancy = {
  facilityNodeId: string;
  facilityLabel: string;
  timelineRow: number;
  /** 這段連續停留的第一張卡（優先取非暫停卡） */
  blockId: string;
  /** 同車同格連續停留合併後，涵蓋的每一張卡 */
  blockIds: string[];
  label: string;
  /** 車進格（這段連續停留最早的一張卡開始） */
  startMinute: number;
  /** 排定的停留／整備卡最晚結束的時刻（不含暫停卡延伸） */
  endMinute: number;
  /**
   * 車真正離開這一格的時刻（分鐘）＝同列下一張「不是停在同一格」的卡開始的時刻。
   * 下一張是移動卡就是移動開始；下一張不是移動卡（缺了必要移動）也只能停在這一刻，
   * 那是銜接失敗，由連續性驗證另外回報，這裡不假設車已經成功開走。
   */
  actualDepartMinute: number;
};

/**
 * 蒐集各設施格跨車的實際佔用區間。
 *
 * <strong>以格位身分為準，不靠時間門檻。</strong>同一列依時間排序後，連續幾張停在
 * 同一格的卡（整備、待命、暫停卡、臨時停格）合併成一段；這一段一直延續到下一張
 * 「不是停在這一格」的卡開始為止——那張通常是移動卡，車從那一刻開走。
 *
 * 先前的版本有兩個漏洞：
 * <ul>
 *   <li>沒有暫停卡時退回「空隙超過 60 秒才算滯留」的推論，60 秒以下的停留全部
 *       看不見（整備到 10:00、出場移動 10:00:30 才開始，佔用只算到 10:00）。</li>
 *   <li>類型清單不含 <code>idle</code>，讓站／提早進廠插的臨時停格整段漏掉。</li>
 * </ul>
 * 空隙是不是移動，看的是下一張卡是不是移動卡，不是看空隙長短。
 *
 * 補暫停卡前後結果一致：暫停卡的格位跟它延伸的那張卡相同，會被併進同一段，
 * 不另開一筆，也不會重複計算。
 */
export function collectFacilityOccupancies(
  timelines: GeneratedSchedulePlan['timelines'],
): FacilityOccupancy[] {
  const out: FacilityOccupancy[] = [];
  for (const timeline of timelines) {
    // 同時刻開始的零長度卡（同區域轉場示意卡）排前面：它在那一刻就把車帶走了
    const ordered = [...timeline.blocks].sort(
      (a, b) =>
        a.plannedStartMinute - b.plannedStartMinute
        || (a.plannedEndMinute - a.plannedStartMinute) - (b.plannedEndMinute - b.plannedStartMinute)
        || a.id.localeCompare(b.id),
    );

    type Run = {
      nodeId: string;
      label: string;
      members: GeneratedScheduleBlock[];
      startMinute: number;
      /** 所有成員（含暫停卡）最晚結束 */
      lastEndMinute: number;
    };
    let run: Run | null = null;

    const close = (current: Run, leaveMinute: number | null) => {
      const stays = current.members.filter((member) => member.source !== 'hold');
      const anchor = stays[0] ?? current.members[0]!;
      const endMinute = stays.length > 0
        ? Math.max(...stays.map((member) => member.plannedEndMinute))
        : current.lastEndMinute;
      const actualDepartMinute = Math.max(current.lastEndMinute, leaveMinute ?? current.lastEndMinute);
      if (actualDepartMinute <= current.startMinute + 1e-9) return;
      out.push({
        facilityNodeId: current.nodeId,
        facilityLabel: current.label,
        timelineRow: timeline.row,
        blockId: anchor.id,
        blockIds: current.members.map((member) => member.id),
        label: anchor.label,
        startMinute: current.startMinute,
        endMinute,
        actualDepartMinute,
      });
    };

    for (const block of ordered) {
      const nodeId = facilityPresenceNodeId(block);
      if (run && nodeId === run.nodeId) {
        run.members.push(block);
        run.lastEndMinute = Math.max(run.lastEndMinute, block.plannedEndMinute);
        continue;
      }
      if (run) {
        close(run, block.plannedStartMinute);
        run = null;
      }
      if (nodeId) {
        run = {
          nodeId,
          label: block.yardFacilityLabel ?? nodeId,
          members: [block],
          startMinute: block.plannedStartMinute,
          lastEndMinute: block.plannedEndMinute,
        };
      }
    }
    // 當天沒排定下一件事就不假設車待到何時，只算到排定的停留結束
    if (run) close(run, null);
  }
  return out;
}

export type FacilityOccupancyCollisionKind = 'overlap' | 'protection_gap';

export type FacilityOccupancyCollision = {
  facilityNodeId: string;
  facilityLabel: string;
  kind: FacilityOccupancyCollisionKind;
  /** 先佔用、先離開的那一台（交接不足時就是讓出格子的那一台） */
  earlier: FacilityOccupancy;
  later: FacilityOccupancy;
  overlapSeconds: number;
  /** 後車進格與前車實際離開的間距（秒，日循環上量）；重疊時為負的重疊秒數 */
  gapSeconds: number;
};

function cyclicForwardSeconds(fromSecond: number, toSecond: number): number {
  return (((toSecond - fromSecond) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
}

/**
 * 不同車在同一設施格的佔用區間不得重疊；沒重疊但交接秒數不夠也回報（分開列出，
 * 呼叫端決定哪一種算硬錯誤——{@link validateFacilityOccupancy} 是重疊記錯誤、
 * 交接不足另外處理，跟站位那邊 {@link findStationBerthCollisions} 同一套規矩）。
 *
 * <strong>重疊與交接都在日循環上量</strong>：引擎內部同一段整備有時記成
 * 「23:5x–1440+」、有時折回鐘面「00:00–01:30」，直接比分鐘數字會漏判（見
 * {@link daySegmentOverlapSeconds}）。交接間距一樣——A 車 23:59:30 離格、B 車
 * 00:00:00 進格，直接相減得到將近一整天，實際只隔 30 秒。兩個方向（A 讓給 B、
 * B 讓給 A）都量，取真正貼著的那一個方向，前車／後車照那個方向標。
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
        const a = sorted[i]!;
        const b = sorted[j]!;
        if (a.timelineRow === b.timelineRow) continue;

        const aStart = minuteToSecond(a.startMinute);
        const aLeave = minuteToSecond(a.actualDepartMinute);
        const bStart = minuteToSecond(b.startMinute);
        const bLeave = minuteToSecond(b.actualDepartMinute);

        const overlapSeconds = daySegmentOverlapSeconds(aStart, aLeave, bStart, bLeave);
        if (overlapSeconds > 1e-6) {
          collisions.push({
            facilityNodeId: a.facilityNodeId,
            facilityLabel: a.facilityLabel,
            kind: 'overlap',
            earlier: a,
            later: b,
            overlapSeconds,
            gapSeconds: -overlapSeconds,
          });
          continue;
        }
        if (requiredSeconds <= 0) continue;

        // 任一段占滿整天就不會有交接（上面已判重疊）
        if (aLeave - aStart >= DAY_SECONDS || bLeave - bStart >= DAY_SECONDS) continue;
        const aThenB = cyclicForwardSeconds(aLeave, bStart);
        const bThenA = cyclicForwardSeconds(bLeave, aStart);
        const aFirst = aThenB <= bThenA;
        const gapSeconds = aFirst ? aThenB : bThenA;
        if (gapSeconds >= requiredSeconds - 1e-6) continue;
        collisions.push({
          facilityNodeId: a.facilityNodeId,
          facilityLabel: a.facilityLabel,
          kind: 'protection_gap',
          earlier: aFirst ? a : b,
          later: aFirst ? b : a,
          overlapSeconds: 0,
          gapSeconds,
        });
      }
    }
  }

  return collisions;
}
