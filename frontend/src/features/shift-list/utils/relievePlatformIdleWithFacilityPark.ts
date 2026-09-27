import type { PointTopology } from '../../map-editor/types/pointTopology';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import { findTopologyPath } from './findTopologyPath';
import {
  collectFacilityOccupancies,
  collectStationBerthOccupancies,
  findFacilityOccupancyCollisions,
  findStationBerthCollisions,
  resolveVehicleReadyMinute,
  type StationBerthOccupancy,
} from './stationBerthOccupancy';
import { daySegmentOverlapSeconds } from './moveCardShared';
import {
  collectMoveJunctionPasses,
  findJunctionConflictsForBlocks,
} from './moveJunctionPasses';
import { validateVehicleLocationContinuity } from './schedule-engine/validate';
import type {
  FeasibilityIssue,
  GeneratedScheduleBlock,
  GeneratedScheduleTimeline,
} from './schedule-engine/types';
import { minuteToSecond, secondToMinute } from './schedule-engine/types';
import { snapUpToClockAlignSeconds } from './schedule-engine/physics';

/**
 * 站位讓渡：把空等的車暫時開進設施格
 * ==================================
 *
 * <strong>決策樹的第四條路。</strong>前三條分別是：待命遷就路線、路線遷就待命
 * （見 alignRouteWithVehicleLocation）、以及沿關聯圖次要邊先開去別站等
 * （見 relievePlatformIdleWithSecondaryEdge）。這一支處理前三條都救不了的情形。
 *
 * <strong>問題長相。</strong>車跑完一趟停在終端站，下一趟要等一段時間才發。
 * 這段期間車實體停在站位上，後面每一台要用這一格的車都被擋。實測（2026-08-17，
 * 真實資料重放）：全線 231 對站位衝突<strong>全部</strong>來自這種空等，沒有一對
 * 是正常經過造成的；擋人者只有 73 個，其中擋最多的一個在 T3下行 空等 38 分鐘、
 * 一口氣擋掉 22 台次。
 *
 * <strong>為什麼不用「空等超過 N 分鐘就處理」這種門檻。</strong>使用者
 * （2026-08-17）：「空等是有需要的那就是讓車空等……不是用一個閥值來決定，因為
 * 不是說他超過閥值了，那我出現錯誤或是警告就好，完全沒意義」。門檻只能生出警告，
 * 生不出解法。真正的判準是<strong>這段空等有沒有擋到別人</strong>——而這個訊號
 * 引擎本來就算得出來：{@link findStationBerthCollisions} 回報的每一對都指名了
 * 擋人的那一筆佔用。有擋到才動它，沒擋到就留著，天生符合「該空等就空等」。
 *
 * <strong>怎麼讓。</strong>把車開進附近的設施格停放，時間到了再開回來，中間插
 * 「入場移動 → 暫停放 → 出場移動」三張卡。下一趟的發車時刻<strong>完全不動</strong>，
 * 只是車在這段期間不佔正線站位。使用者已確認願意付這個空跑代價：多數案例來回
 * 只要 60 秒，換掉十幾到三十幾分鐘的站位佔用。
 *
 * <strong>設施格借用的紀律。</strong>使用者（2026-08-17）：「設施格你使用了當然
 * 會影響設施，所以如果有其他車輛要使用要讓出來，但如果沒有使用當然可以暫停」。
 * 因此只借<strong>整段空等期間都空著</strong>的格子——任何整備卡（或先前已排定的
 * 停放）與該區間有一點重疊就不借，不做「先佔了再說、之後再讓」。
 *
 * <strong>自我驗證。</strong>每插一組卡就重算站位碰撞；沒有真的變少就整組撤回。
 * 語意上永遠不比「不做這件事」更差，與本檔案群既有的
 * <code>moveKeepsBerthsClear</code> 同一套規矩。
 *
 * 放在幾何收斂迴圈<strong>裡面</strong>、站位求解之前：插卡會改變站位佔用，
 * 必須讓求解器在同一輪就看得到。
 */

/** 設施節點的標籤樣式（E1／H2／M4／W1…）。設施節點沒有 stationId，靠標籤辨識 */
const FACILITY_LABEL_PATTERN = /^[A-Z]{1,2}\d{1,2}$/;

/** 停進去至少要待這麼久才划算——比這短的話光是進出就把時間吃完了 */
const MIN_PARK_SECONDS = 60;

type ParkCandidate = {
  /** 擋人的那一筆站位佔用（終站、且停靠完還賴著） */
  occupancy: StationBerthOccupancy;
  /** 這一筆擋掉幾台車 */
  blockedCount: number;
  facilityNodeId: string;
  facilityLabel: string;
  inboundSeconds: number;
  outboundSeconds: number;
  /** 去程／回程實際途經的節點名稱（含起訖），給卡片顯示分段用 */
  inboundVia: string[];
  outboundVia: string[];
};

/** 把拓樸路徑轉成可讀節點名稱（含起訖）；讓移動卡跟載客卡一樣看得到分段 */
function pathViaLabels(
  topology: PointTopology,
  path: { nodeIds: string[] } | null | undefined,
): string[] {
  if (!path) return [];
  const labelById = new Map(
    topology.nodes.map((node) => [node.id, (node.label ?? '').trim()] as const),
  );
  return path.nodeIds.map((nodeId) => labelById.get(nodeId) || nodeId);
}

function facilityNodes(topology: PointTopology): { id: string; label: string }[] {
  return topology.nodes
    .filter((node) => !node.stationId?.trim())
    .map((node) => ({ id: node.id, label: (node.label ?? '').trim() }))
    .filter((node) => FACILITY_LABEL_PATTERN.test(node.label));
}

type FacilityBusyWindow = { startSecond: number; endSecond: number; timelineRow: number };

/**
 * 每個設施節點目前被哪些區間佔著——跟最終驗證<strong>同一份</strong>佔用定義。
 *
 * 先前只看卡片自己的 [開始, 結束]：整備做完、車還沒開走的那段是空的，臨時停格與
 * 暫停卡也各算各的。現在直接用 {@link collectFacilityOccupancies}（車真正離格的時刻、
 * 同車同格合併、臨時停格也算），再加上從設施出發的移動卡本身。
 */
function collectFacilityBusyWindows(
  timelines: GeneratedScheduleTimeline[],
): Map<string, FacilityBusyWindow[]> {
  const busy = new Map<string, FacilityBusyWindow[]>();
  const push = (nodeId: string, window: FacilityBusyWindow) => {
    const list = busy.get(nodeId) ?? [];
    list.push(window);
    busy.set(nodeId, list);
  };
  for (const occ of collectFacilityOccupancies(timelines)) {
    push(occ.facilityNodeId, {
      startSecond: minuteToSecond(occ.startMinute),
      endSecond: minuteToSecond(occ.actualDepartMinute),
      timelineRow: occ.timelineRow,
    });
  }
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (block.source !== 'yard_exit_move') continue;
      const nodeId = block.yardExitFacilityNodeId?.trim();
      if (!nodeId) continue;
      push(nodeId, {
        startSecond: minuteToSecond(block.plannedStartMinute),
        endSecond: minuteToSecond(block.plannedEndMinute),
        timelineRow: timeline.row,
      });
    }
  }
  return busy;
}

/**
 * 這一格在 [start, end]（分鐘）這段能不能給這台車停：別列車的佔用前後各要讓出
 * 交接間隔（2 × 碰撞保護，跟 FACILITY_HANDOVER_GAP 同一條規則），日循環比對。
 * 同一列（同一台車）自己的佔用不算。
 */
function facilityIsFree(
  busy: Map<string, FacilityBusyWindow[]>,
  nodeId: string,
  startMinute: number,
  endMinute: number,
  timelineRow: number,
  handoverSeconds: number,
): boolean {
  const startSecond = minuteToSecond(startMinute) - handoverSeconds;
  const endSecond = minuteToSecond(endMinute) + handoverSeconds;
  return !(busy.get(nodeId) ?? []).some(
    (window) =>
      window.timelineRow !== timelineRow
      && daySegmentOverlapSeconds(startSecond, endSecond, window.startSecond, window.endSecond) > 1e-6,
  );
}

/**
 * 插卡後的整體檢查：站位衝突要真的變少，而且不能拿別的安全問題去換——設施格
 * 重疊／交接不能變多、新卡經過的轉折點不能貼著別列車、這台車的位置要接得起來。
 */
function countFacilityCollisions(
  timelines: GeneratedScheduleTimeline[],
  collisionProtectionSeconds: number,
): number {
  return findFacilityOccupancyCollisions(
    collectFacilityOccupancies(timelines),
    collisionProtectionSeconds,
  ).length;
}

function countRowDiscontinuities(
  timeline: GeneratedScheduleTimeline,
  selectedRoutes: ShiftScheduleSelectedRoute[],
): number {
  const errors: FeasibilityIssue[] = [];
  validateVehicleLocationContinuity({ timelines: [timeline], selectedRoutes, errors });
  return errors.length;
}

/**
 * 這一筆佔用「停靠完之後還賴在站上」多久。
 *
 * <code>endMinute</code> 是靠站結束、<code>actualDepartMinute</code> 是車真的
 * 開走的時刻；兩者的差就是純粹佔著站位、什麼也沒做的時間。
 */
function lingerMinutes(occupancy: StationBerthOccupancy, minimumRecoveryTimeSeconds: number): number {
  return Math.max(
    0,
    occupancy.actualDepartMinute - resolveVehicleReadyMinute(occupancy, minimumRecoveryTimeSeconds),
  );
}

function countBlockedBy(
  timelines: GeneratedScheduleTimeline[],
  selectedRoutes: ShiftScheduleSelectedRoute[],
  collisionProtectionSeconds: number,
): { total: number; byOccupancy: Map<string, { count: number; occupancy: StationBerthOccupancy }> } {
  const occupancies = collectStationBerthOccupancies(timelines, selectedRoutes, {
    collisionProtectionSeconds,
  });
  const collisions = findStationBerthCollisions(occupancies, selectedRoutes);
  const byOccupancy = new Map<
    string,
    { count: number; occupancy: StationBerthOccupancy }
  >();
  for (const collision of collisions) {
    // 一張卡在多個站各有一筆佔用，擋人的是終站那一筆——鍵要含站位，不能只用 blockId
    const key = `${collision.earlier.blockId}@${collision.earlier.stationId}`;
    const current = byOccupancy.get(key) ?? { count: 0, occupancy: collision.earlier };
    current.count += 1;
    byOccupancy.set(key, current);
  }
  return { total: collisions.length, byOccupancy };
}

export function relievePlatformIdleWithFacilityPark(args: {
  timelines: GeneratedScheduleTimeline[];
  selectedRoutes: ShiftScheduleSelectedRoute[];
  topology?: PointTopology | null;
  collisionProtectionSeconds: number;
  /**
   * 最低恢復時間（秒）：車跑完一趟到能開去別處之間至少要隔的時間，跟入廠卡同一條
   * 規則。沒給當 0（舊呼叫端），生成流程一律要給。
   */
  minimumRecoveryTimeSeconds?: number;
  /**
   * 只處理這幾列：既有的讓站卡全部保留（要重排哪幾張由呼叫端先拆掉），其他列不會被
   * 挑來處理。候選改了某一列的時刻之後用這個補那一列，不為局部修復拆掉全場的讓站卡。
   */
  onlyRows?: ReadonlySet<number>;
  /** 最多處理幾筆；每筆都要重算站位驗證，設上限避免病態輸入拖垮生成 */
  maxRelief?: number;
  /** 只在第一輪收集，避免收斂迴圈每輪重複回報同一件事 */
  warnings?: FeasibilityIssue[];
}): { timelines: GeneratedScheduleTimeline[]; parked: number } {
  const {
    selectedRoutes,
    topology,
    collisionProtectionSeconds,
    minimumRecoveryTimeSeconds = 0,
    onlyRows,
    maxRelief = 80,
    warnings,
  } = args;

  if (!topology || topology.nodes.length === 0) {
    return { timelines: args.timelines, parked: 0 };
  }
  if (collisionProtectionSeconds <= 0) {
    return { timelines: args.timelines, parked: 0 };
  }

  // 可重入：先清掉自己上次插的卡，避免重複呼叫時疊加（只補指定列時由呼叫端決定拆哪幾張）
  const timelines = args.timelines.map((timeline) => ({
    ...timeline,
    blocks: timeline.blocks
      .filter((block) => onlyRows != null || !block.id.startsWith('berthpark-'))
      .map((block) => ({ ...block })),
  }));

  const facilities = facilityNodes(topology);
  if (facilities.length === 0) return { timelines, parked: 0 };

  const stationNodeId = new Map<string, string>();
  for (const node of topology.nodes) {
    const stationId = node.stationId?.trim();
    if (stationId && !stationNodeId.has(stationId)) stationNodeId.set(stationId, node.id);
  }

  /** 已經處理過的佔用（成功或放棄都記），避免同一輪反覆挑到同一筆 */
  const handled = new Set<string>();
  let parked = 0;
  const handoverSeconds = collisionProtectionSeconds * 2;

  /**
   * 插卡之後、接受之前的安全閘：設施格重疊／交接不能變多、新卡（與被挪動的卡）
   * 經過的轉折點不能貼著別列車、這台車自己的位置要接得起來。站位變少只是
   * 必要條件——拿設施或轉折點的安全問題去換站位，不算改善。
   */
  const passesSafetyGate = (
    timelineForRow: GeneratedScheduleTimeline,
    touchedBlockIds: ReadonlySet<string>,
    facilityBefore: number,
    rowDiscontinuityBefore: number,
  ): { ok: boolean; junctionConflicts: ReturnType<typeof findJunctionConflictsForBlocks> } => {
    if (countFacilityCollisions(timelines, collisionProtectionSeconds) > facilityBefore) {
      return { ok: false, junctionConflicts: [] };
    }
    if (countRowDiscontinuities(timelineForRow, selectedRoutes) > rowDiscontinuityBefore) {
      return { ok: false, junctionConflicts: [] };
    }
    const passes = collectMoveJunctionPasses(timelines, topology);
    const junctionConflicts = findJunctionConflictsForBlocks(passes, touchedBlockIds, handoverSeconds);
    return { ok: junctionConflicts.length === 0, junctionConflicts };
  };

  for (let round = 0; round < maxRelief; round += 1) {
    const { total, byOccupancy } = countBlockedBy(
      timelines,
      selectedRoutes,
      collisionProtectionSeconds,
    );
    if (total === 0) break;
    const facilityBefore = countFacilityCollisions(timelines, collisionProtectionSeconds);

    // 擋最多的先處理——收斂最快，且一次動一個才能逐筆驗證
    const ranked = [...byOccupancy.entries()]
      .filter(([key]) => !handled.has(key))
      .sort((a, b) => b[1].count - a[1].count);
    if (ranked.length === 0) break;

    let applied = false;
    for (const [key, { count, occupancy }] of ranked) {
      if (onlyRows && !onlyRows.has(occupancy.timelineRow)) {
        handled.add(key);
        continue;
      }
      const idle = lingerMinutes(occupancy, minimumRecoveryTimeSeconds);
      // 車最早可以動的時刻：停靠完成＋最低恢復（不是為了防漏判補的最小佔用）
      const readyMinute = resolveVehicleReadyMinute(occupancy, minimumRecoveryTimeSeconds);
      if (idle <= 1 / 60) {
        handled.add(key);
        continue;
      }
      const fromNodeId = stationNodeId.get(occupancy.stationId);
      if (!fromNodeId) {
        handled.add(key);
        continue;
      }

      const timelineForRow = timelines.find((item) => item.row === occupancy.timelineRow);
      if (!timelineForRow) {
        handled.add(key);
        continue;
      }
      /**
       * 這段空等的下一張卡必須是正線，否則不碰。
       *
       * 整備前的空檔<strong>屬於整備轉場卡</strong>（入廠／出場移動）。那些卡是在
       * 幾何收斂迴圈<strong>跑完之後</strong>才真正插進去的（迴圈裡只先決定地點），
       * 所以在這裡看起來是空的，實際上已經被預定了。硬塞進去的結果是整整 391 則
       * TIMELINE_OVERLAP——2026-08-17 第一版就是這樣炸的。
       *
       * 正線→正線之間的空檔沒有這個問題，只處理那一種。
       */
      const nextBlock = timelineForRow.blocks
        .filter((block) => block.plannedStartMinute + 1e-9 >= occupancy.readyMinute)
        .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute)[0];
      if (!nextBlock) {
        handled.add(key);
        continue;
      }

      /**
       * <strong>空等完接的是「進廠」時：提早進去等，不要在站上等。</strong>
       *
       * 車跑完最後一輪、等著進整備廠的這一段，是站位壓力最大的一類——實測
       * （2026-08-18）N2W下行出發 剩餘衝突的擋人者幾乎全是這種，最長一台在站上
       * 乾等 38 分鐘、擋掉 9 台後車，而同一時段還有 4 個設施格空著。
       *
       * 做法是把<strong>既有的入廠移動卡整張往前挪</strong>到「跑完就走」，後面補
       * 一張暫停放卡把設施格佔到原訂進廠時刻。<strong>整備本身的時刻完全不動</strong>
       * ——差別只在車是在站位上等，還是在自己要進的那一格裡等。
       *
       * 借的就是它本來要去的那一格，不會跟別人搶：仍然要求那一格在整段等待期間
       * 都空著，有任何預約重疊就放棄（提早進廠不能是特權，見
       * insertMaintenanceTransferCards 對排擠案例的說明）。
       */
      if (nextBlock.source === 'yard_entry_move') {
        const targetNodeId = nextBlock.yardExitFacilityNodeId?.trim();
        const targetLabel = nextBlock.yardExitFacilityLabel ?? targetNodeId ?? '';
        const arriveMinute = nextBlock.plannedEndMinute;
        const leaveSecond = minuteToSecond(readyMinute);
        const busyForEntry = collectFacilityBusyWindows(timelines);
        if (!targetNodeId) {
          handled.add(key);
          continue;
        }

        /**
         * 甲：整備要用的那一格，在整段等待期間本來就空著。
         *
         * 這時什麼都不用多插，把既有的入廠移動卡整張往前挪到「跑完就走」即可，
         * 後面補一張停放卡把格子佔住。
         */
        let plan: {
          waitNodeId: string;
          waitLabel: string;
          inboundSeconds: number;
          hopSeconds: number;
          viaLabels: string[];
        } | null = null;
        const ownTravelSeconds = Math.max(0, nextBlock.travelSeconds ?? 0);
        const ownArriveSecond = snapUpToClockAlignSeconds(leaveSecond + ownTravelSeconds);
        if (
          ownTravelSeconds > 0
          && secondToMinute(ownArriveSecond) < arriveMinute - MIN_PARK_SECONDS / 60
          && facilityIsFree(
            busyForEntry, targetNodeId, secondToMinute(ownArriveSecond), arriveMinute,
            timelineForRow.row, handoverSeconds,
          )
        ) {
          plan = {
            waitNodeId: targetNodeId,
            waitLabel: targetLabel,
            inboundSeconds: ownTravelSeconds,
            hopSeconds: 0,
            // 甲沿用既有的入廠移動卡，途經節點就查同一段路
            viaLabels: pathViaLabels(
              topology,
              findTopologyPath(topology, fromNodeId, targetNodeId),
            ),
          };
        }

        /**
         * 乙：整備要用的那一格在等待期間有人在用——借別格站著等。
         *
         * 使用者（2026-08-18）：「你在設施使用的時候當然不能互換，但你是待命的
         * 當然哪裡都可以去」。等待不是使用設施，只是站在那裡，所以中途格<strong>不
         * 限同類</strong>；真正要進去做整備的那一格仍然是原本排定的那一格，
         * <strong>時刻與地點都不動</strong>。
         *
         * 路徑變成 停靠站 → 中途格（等） → 整備格，最後一段的抵達時刻剛好貼齊
         * 原訂進廠時刻。中途格同樣要求整段等待期間都空著。
         */
        if (!plan) {
          for (const facility of facilities) {
            if (facility.id === targetNodeId) continue;
            const inbound = findTopologyPath(topology, fromNodeId, facility.id);
            const hop = findTopologyPath(topology, facility.id, targetNodeId);
            if (!inbound || !hop) continue;
            const waitStartSecond = snapUpToClockAlignSeconds(leaveSecond + inbound.avgSeconds);
            const waitEndSecond = minuteToSecond(arriveMinute) - hop.avgSeconds;
            if (waitEndSecond <= waitStartSecond + MIN_PARK_SECONDS) continue;
            if (
              !facilityIsFree(
                busyForEntry,
                facility.id,
                secondToMinute(waitStartSecond),
                secondToMinute(waitEndSecond),
                timelineForRow.row,
                handoverSeconds,
              )
            ) continue;
            const cost = inbound.avgSeconds + hop.avgSeconds;
            if (plan && cost >= plan.inboundSeconds + plan.hopSeconds) continue;
            plan = {
              waitNodeId: facility.id,
              waitLabel: facility.label,
              inboundSeconds: inbound.avgSeconds,
              hopSeconds: hop.avgSeconds,
              viaLabels: pathViaLabels(topology, inbound),
            };
          }
        }

        if (!plan) {
          handled.add(key);
          continue;
        }

        /**
         * 甲／乙兩案唯一的判準：中途格身分是不是就是目的整備格本人。
         *
         * <strong>不能用 <code>plan.hopSeconds === 0</code> 判斷。</strong>甲的
         * hopSeconds 恆為 0（沒有中途格，本來就不必再跳一段）；但乙的中途格若跟
         * 目的格在拓樸上零秒相鄰（沒填行駛時間、或就是零秒轉場），
         * <code>hop.avgSeconds</code> 一樣會算出 0——這時兩案的 hopSeconds 一樣，
         * 但物理事實完全不同：乙的車還停在別格（例 W1），沒有真的到 E2。
         * 拿 hopSeconds 當判準會把乙誤當甲，害中途格的佔用整段憑空消失，
         * 且把目的格的整備時刻拉到車根本還沒到的時間點（2026-09-25 實錄：
         * W1 借用零秒轉場到 E2，充電被錯誤提前到 23:46:50，撞上另一台車還在
         * E2 待到 00:00:00 的整備，兩車同格重疊 790 秒）。
         */
        const isDirectEntry = plan.waitNodeId === targetNodeId;

        const stationLabel = occupancy.stationName ?? occupancy.stationId;
        const idTag = `${occupancy.blockId}-${Math.round(leaveSecond)}`;
        const waitStartSecond = snapUpToClockAlignSeconds(leaveSecond + plan.inboundSeconds);
        const waitEndSecond = minuteToSecond(arriveMinute) - plan.hopSeconds;
        /**
         * 整備區塊本身：甲的情形要讓它<strong>自己往前長</strong>，不要在中間插等待卡。
         *
         * 使用者（2026-08-18）：「你就是入廠卡一張，然後後面就是尾巴直接接著充電卡，
         * 就是直接安排充電了……你決定要進去了，就是一張入場，後面就是接整備，不要猶豫」。
         * 車已經開進那一格了，卻顯示成「等待 27 分鐘、10:00 才開始充電」，班表上讀到的
         * 整備時刻就不是真的。這與 insertMaintenanceTransferCards 的「車一到就開始整備」
         * 是同一條規則，做法四不該繞過它。
         */
        const yardAfterEntry = timelineForRow.blocks
          .filter(
            (block) =>
              block.plannedStartMinute + 1e-9 >= arriveMinute
              && (block.yardFacilityNodeId?.trim() ?? '') === targetNodeId,
          )
          .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute)[0] ?? null;

        const added: GeneratedScheduleBlock[] = [];
        // 乙才需要自己的入場移動卡；甲直接沿用既有的入廠移動卡
        if (!isDirectEntry) {
          added.push({
            id: `berthpark-early-in-${idTag}`,
            timelineRow: timelineForRow.row,
            taskType: 'dispatch',
            label: `讓站移動 · ${stationLabel} → ${plan.waitLabel}`,
            anchorStartMinute: secondToMinute(leaveSecond),
            plannedStartMinute: secondToMinute(leaveSecond),
            plannedEndMinute: secondToMinute(waitStartSecond),
            travelSeconds: plan.inboundSeconds,
            dwellSeconds: 0,
            source: 'yard_entry_move',
            yardMoveViaLabels: plan.viaLabels,
            yardEntryFacilityNodeId: plan.waitNodeId,
            yardEntryFacilityLabel: plan.waitLabel,
          } as GeneratedScheduleBlock);
        }
        const pullYardHead = isDirectEntry && yardAfterEntry != null;
        if (!pullYardHead) added.push({
          id: `berthpark-early-stay-${idTag}`,
          timelineRow: timelineForRow.row,
          // 與做法三同理，掛 idle 而非 standby，避免整備轉場機制重複服務
          taskType: 'idle',
          label: `提早進廠等待 · ${plan.waitLabel}`,
          anchorStartMinute: secondToMinute(waitStartSecond),
          plannedStartMinute: secondToMinute(waitStartSecond),
          plannedEndMinute: secondToMinute(waitEndSecond),
          travelSeconds: 0,
          dwellSeconds: waitEndSecond - waitStartSecond,
          source: 'transition',
          yardFacilityNodeId: plan.waitNodeId,
          yardFacilityLabel: plan.waitLabel,
        } as GeneratedScheduleBlock);

        const keepStart = nextBlock.plannedStartMinute;
        const keepEnd = nextBlock.plannedEndMinute;
        const keepAnchor = nextBlock.anchorStartMinute;
        const keepTravel = nextBlock.travelSeconds;
        const movedStartMinute = !isDirectEntry
          ? secondToMinute(waitEndSecond)
          : secondToMinute(leaveSecond);
        // 先檢查再動：任何一條早退路徑都不能留下改到一半的版面。
        // 被往前拉的整備區塊本人不算重疊——它的頭正是要蓋掉這段空白。
        const clashesEarly = timelineForRow.blocks.some(
          (block) =>
            block.id !== nextBlock.id
            && block.id !== yardAfterEntry?.id
            && block.plannedStartMinute < arriveMinute - 1e-9
            && block.plannedEndMinute > secondToMinute(leaveSecond) + 1e-9,
        );
        if (clashesEarly) {
          handled.add(key);
          continue;
        }

        /**
         * 甲：整備<strong>自己往前長</strong>到抵達時刻，不插等待卡。
         *
         * 使用者（2026-08-18）：「你就是入廠卡一張，然後後面就是尾巴直接接著充電卡，
         * 就是直接安排充電了……你決定要進去了，就是一張入場，後面就是接整備，不要猶豫」。
         * 車已經開進那一格了卻顯示「10:00 才開始充電」，班表上讀到的整備時刻就不是真的。
         * 與 insertMaintenanceTransferCards 的「車一到就開始整備」同一條規則。
         */
        const rowDiscontinuityBefore = countRowDiscontinuities(timelineForRow, selectedRoutes);
        const keepYardStart = yardAfterEntry?.plannedStartMinute ?? null;
        const keepYardAnchor = yardAfterEntry?.anchorStartMinute ?? null;
        if (pullYardHead && yardAfterEntry) {
          yardAfterEntry.plannedStartMinute = secondToMinute(waitStartSecond);
          if (yardAfterEntry.anchorStartMinute != null) {
            yardAfterEntry.anchorStartMinute = secondToMinute(waitStartSecond);
          }
        }

        nextBlock.plannedStartMinute = movedStartMinute;
        nextBlock.anchorStartMinute = movedStartMinute;
        nextBlock.plannedEndMinute = !isDirectEntry ? arriveMinute : secondToMinute(waitStartSecond);
        if (!isDirectEntry) nextBlock.travelSeconds = plan.hopSeconds;
        timelineForRow.blocks.push(...added);
        const afterEarly = countBlockedBy(timelines, selectedRoutes, collisionProtectionSeconds);
        const touchedEarly = new Set([nextBlock.id, ...added.map((card) => card.id)]);
        if (
          afterEarly.total >= total
          || !passesSafetyGate(timelineForRow, touchedEarly, facilityBefore, rowDiscontinuityBefore).ok
        ) {
          if (yardAfterEntry && keepYardStart != null) {
            yardAfterEntry.plannedStartMinute = keepYardStart;
            if (keepYardAnchor != null) yardAfterEntry.anchorStartMinute = keepYardAnchor;
          }
          nextBlock.plannedStartMinute = keepStart;
          nextBlock.plannedEndMinute = keepEnd;
          nextBlock.anchorStartMinute = keepAnchor;
          nextBlock.travelSeconds = keepTravel;
          const ids = new Set(added.map((card) => card.id));
          timelineForRow.blocks = timelineForRow.blocks.filter((block) => !ids.has(block.id));
          handled.add(key);
          continue;
        }
        handled.add(key);
        parked += 1;
        applied = true;
        warnings?.push({
          code: 'STATION_BERTH_ARRIVAL_YIELDED',
          severity: 'warning',
          kind: 'policy',
          message:
            `時間線 ${timelineForRow.row}：跑完一趟在`
            + `「${stationLabel}」等著進廠 ${idle.toFixed(1)} 分鐘，`
            + `擋住 ${count} 台後車——已改成跑完就開進「${plan.waitLabel}」`
            + (!isDirectEntry
              ? `等，再開進「${targetLabel}」整備，整備時刻不變。`
              : '，整備跟著提早開始（結束時刻不變）。'),
          detail: {
            timelineRow: timelineForRow.row,
            blockId: occupancy.blockId,
            stationId: occupancy.stationId,
            idleMinutes: Number(idle.toFixed(2)),
            affectedPairCount: count,
            parkedStationId: plan.waitNodeId,
          },
        });
        break;
      }

      if (nextBlock.taskType !== 'passenger') {
        handled.add(key);
        continue;
      }

      const busy = collectFacilityBusyWindows(timelines);
      const parkStart = readyMinute;
      const parkEnd = occupancy.actualDepartMinute;

      // 依來回成本排序，逐一驗證——第一格失敗不代表所有設施都不行
      const options: ParkCandidate[] = [];
      for (const facility of facilities) {
        // 整段空等期間都空著才借；有一點重疊就跳過（不做先佔後讓）
        if (
          !facilityIsFree(busy, facility.id, parkStart, parkEnd, timelineForRow.row, handoverSeconds)
        ) continue;
        const inbound = findTopologyPath(topology, fromNodeId, facility.id);
        const outbound = findTopologyPath(topology, facility.id, fromNodeId);
        if (!inbound || !outbound) continue;
        const roundTripSeconds = inbound.avgSeconds + outbound.avgSeconds;
        // 進出加上最短停留仍塞不進這段空等 → 這一格沒意義
        if (roundTripSeconds + MIN_PARK_SECONDS >= idle * 60) continue;
        options.push({
          occupancy,
          blockedCount: count,
          facilityNodeId: facility.id,
          facilityLabel: facility.label,
          inboundSeconds: inbound.avgSeconds,
          outboundSeconds: outbound.avgSeconds,
          inboundVia: pathViaLabels(topology, inbound),
          outboundVia: pathViaLabels(topology, outbound),
        });
      }
      options.sort(
        (a, b) => a.inboundSeconds + a.outboundSeconds - (b.inboundSeconds + b.outboundSeconds)
          || a.facilityLabel.localeCompare(b.facilityLabel),
      );

      if (options.length === 0) {
        handled.add(key);
        continue;
      }

      let inserted: GeneratedScheduleBlock[] | null = null;
      let chosen: ParkCandidate | null = null;
      for (const best of options) {
      const timeline = timelineForRow;

      const stationLabel = occupancy.stationName ?? occupancy.stationId;
      const buildParkCards = (
        inDelaySeconds: number,
        outAdvanceSeconds: number,
      ): GeneratedScheduleBlock[] | null => {
        const inStartSecond = minuteToSecond(parkStart) + inDelaySeconds;
        const inEndSecond = snapUpToClockAlignSeconds(inStartSecond + best!.inboundSeconds);
        const outEndSecond = minuteToSecond(parkEnd);
        const outStartSecond = outEndSecond - best!.outboundSeconds - outAdvanceSeconds;
        if (outStartSecond <= inEndSecond + MIN_PARK_SECONDS) return null;
        const idTag = `${occupancy.blockId}-${Math.round(minuteToSecond(parkStart))}`;
        return [
          {
            id: `berthpark-in-${idTag}`,
            timelineRow: timeline.row,
            taskType: 'dispatch',
            label: `讓站移動 · ${stationLabel} → ${best!.facilityLabel}`,
            anchorStartMinute: secondToMinute(inStartSecond),
            plannedStartMinute: secondToMinute(inStartSecond),
            plannedEndMinute: secondToMinute(inEndSecond),
            travelSeconds: best!.inboundSeconds,
            dwellSeconds: 0,
            source: 'yard_entry_move',
            yardMoveViaLabels: best!.inboundVia,
            yardEntryFacilityNodeId: best!.facilityNodeId,
            yardEntryFacilityLabel: best!.facilityLabel,
          } as GeneratedScheduleBlock,
          {
            id: `berthpark-stay-${idTag}`,
            timelineRow: timeline.row,
            /**
             * <strong>不能用 standby。</strong>整備轉場機制是以
             * <code>taskType === 'standby'</code> 認定「這是一段排定的待命，要幫它排
             * 進出廠卡」。本支自己插的暫停放已經自帶讓站移動／讓站返回兩張卡，若也
             * 掛成 standby，轉場機制會再幫它產生一組進出廠卡——2026-08-18 實測就是
             * 這樣冒出「前面根本沒有整備」的孤兒出場移動卡，並與正線班次重疊；
             * MAINTENANCE_TRANSFER_UNRESOLVED 從 13 暴增到 22 且全部是 standby，
             * 也是同一個原因（轉場機制在服務本來不存在的待命）。
             * 用引擎的過渡型別 idle，轉場機制不會認領。
             */
            taskType: 'idle',
            label: `暫停放 · ${best!.facilityLabel}`,
            anchorStartMinute: secondToMinute(inEndSecond),
            plannedStartMinute: secondToMinute(inEndSecond),
            plannedEndMinute: secondToMinute(outStartSecond),
            travelSeconds: 0,
            dwellSeconds: outStartSecond - inEndSecond,
            source: 'transition',
            yardFacilityNodeId: best!.facilityNodeId,
            yardFacilityLabel: best!.facilityLabel,
          } as GeneratedScheduleBlock,
          {
            id: `berthpark-out-${idTag}`,
            timelineRow: timeline.row,
            taskType: 'dispatch',
            label: `讓站返回 · ${best!.facilityLabel} → ${stationLabel}`,
            anchorStartMinute: secondToMinute(outStartSecond),
            plannedStartMinute: secondToMinute(outStartSecond),
            plannedEndMinute: secondToMinute(outStartSecond + best!.outboundSeconds),
            travelSeconds: best!.outboundSeconds,
            dwellSeconds: 0,
            source: 'yard_exit_move',
            yardMoveViaLabels: best!.outboundVia,
            yardExitFacilityNodeId: best!.facilityNodeId,
            yardExitFacilityLabel: best!.facilityLabel,
            yardExitStationId: occupancy.stationId,
            yardExitStationLabel: stationLabel,
          } as GeneratedScheduleBlock,
        ];
      };

      /**
       * 候選時刻：先照原訂（跑完就走、剛好趕上下一班回來）。撞到別列車在同一個轉折點
       * 經過時，不直接放棄——擋路的是哪一筆、它幾點經過都知道，答案就貼在它的緩衝
       * 邊緣：讓站移動晚一點出發（車在站上多停幾秒），或讓站返回早一點出發（早回
       * 到站上等）。每個候選都重新過一次完整的安全閘，全域站位要真的變少才採用。
       */
      const attempts: Array<[number, number]> = [[0, 0]];
      const tried = new Set<string>();
      for (let attempt = 0; attempt < attempts.length && attempt < 8; attempt += 1) {
        const [inDelay, outAdvance] = attempts[attempt]!;
        const tag = `${inDelay}|${outAdvance}`;
        if (tried.has(tag)) continue;
        tried.add(tag);
        const cards = buildParkCards(inDelay, outAdvance);
        if (!cards) continue;
        /**
         * 硬檢查：三張卡都不得與同列既有卡片重疊。
         *
         * 空等區間理論上是空的，但整備轉場卡、進場載客等機制都可能把卡片排進來，
         * 而它們的時刻不歸這一支管。重疊會直接變成 TIMELINE_OVERLAP 硬錯誤，
         * 寧可放棄這一筆讓渡，也不能產生無效班表。
         */
        const clashes = timeline.blocks.some((block) =>
          cards.some(
            (card) =>
              block.plannedStartMinute < card.plannedEndMinute - 1e-9
              && block.plannedEndMinute > card.plannedStartMinute + 1e-9,
          ),
        );
        if (clashes) continue;

        // 先插，再驗證；沒有真的變少、或拿別的安全問題去換，就整組撤回
        const rowDiscontinuityBefore = countRowDiscontinuities(timeline, selectedRoutes);
        timeline.blocks.push(...cards);
        const after = countBlockedBy(timelines, selectedRoutes, collisionProtectionSeconds);
        const gate = after.total < total
          ? passesSafetyGate(
            timeline,
            new Set(cards.map((card) => card.id)),
            facilityBefore,
            rowDiscontinuityBefore,
          )
          : { ok: false, junctionConflicts: [] };
        if (gate.ok) {
          inserted = cards;
          break;
        }
        const ids = new Set(cards.map((card) => card.id));
        timeline.blocks = timeline.blocks.filter((block) => !ids.has(block.id));
        for (const conflict of gate.junctionConflicts) {
          const isInbound = conflict.mine.blockId.startsWith('berthpark-in-');
          const needed = snapUpToClockAlignSeconds(
            isInbound
              ? conflict.other.instant + handoverSeconds - conflict.mine.instant
              : conflict.mine.instant - (conflict.other.instant - handoverSeconds),
          );
          if (needed <= 0) continue;
          attempts.push(isInbound ? [inDelay + needed, outAdvance] : [inDelay, outAdvance + needed]);
        }
      }
        if (inserted) {
          chosen = best;
          break;
        }
      }
      if (!inserted || !chosen) {
        handled.add(key);
        continue;
      }
      const best = chosen;
      const timeline = timelineForRow;
      const stationLabel = occupancy.stationName ?? occupancy.stationId;

      handled.add(key);
      parked += 1;
      applied = true;
      warnings?.push({
        code: 'STATION_BERTH_ARRIVAL_YIELDED',
        severity: 'warning',
        kind: 'policy',
        message:
          `時間線 ${timeline.row}：跑完一趟在「${stationLabel}」空等 ${idle.toFixed(1)} 分鐘，`
          + `擋住 ${count} 台後車——已改開進「${best.facilityLabel}」暫停放，`
          + `來回空駛 ${Math.round(best.inboundSeconds + best.outboundSeconds)} 秒，`
          + `下一趟發車時刻不變。`,
        detail: {
          timelineRow: timeline.row,
          blockId: occupancy.blockId,
          stationId: occupancy.stationId,
          idleMinutes: Number(idle.toFixed(2)),
          affectedPairCount: count,
          parkedStationId: best.facilityNodeId,
        },
      });
      break;
    }

    if (!applied) break;
  }

  return { timelines, parked };
}
