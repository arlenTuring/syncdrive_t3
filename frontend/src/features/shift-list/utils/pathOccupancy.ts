import type { PointTopology, PointTopologyEdge } from '../../map-editor/types/pointTopology';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import { buildBlockStationDepartures, resolveRouteForBlock } from './buildBlockStationDepartures';
import { edgeHasTravelTime, edgeSeconds, findTopologyPath } from './findTopologyPath';
import type { GeneratedScheduleBlock, GeneratedScheduleTimeline } from './schedule-engine/types';
import { minuteToSecond } from './schedule-engine/types';

/**
 * 路徑佔用：整條行駛路徑的時間可行性
 * ==================================
 *
 * 一台車在路網上走的每一步都佔用實體空間：經過或停在一個節點，沿一段有方向的路段開。
 * 載客班次、出入場、整備轉場這些卡片各自排時刻，但它們走的是同一張路網——只檢查
 * 「格位」「第一個轉折點」「終點站位」不夠，中途經過的月台、共用的路段都可能撞上。
 *
 * 2026-11-08 實測：出場移動 D1 → NW下發1（22:00:30 出發）在 22:01:30 經過 T3上行，
 * 同一刻別列車的 ST2159 剛開進 T3上行、停 40 秒到 22:02:10 才發車。排卡時只看了
 * 「整備調度入口點」那一個轉折點，模擬器照實際行駛只能在月台外等，晚到 41 秒。
 *
 * 這裡把每張卡展開成「軌跡」，再用三條約束判定兩台不同的車會不會撞上：
 *
 * 1. <strong>節點</strong>：兩台車在同一個節點的佔用區間（經過＝一瞬間，停靠＝到站到離站）
 *    至少要差開緩衝（2 × 碰撞保護，跟轉折點、站位同一個數字）。
 * 2. <strong>同向不超車</strong>：兩台車走同一段有方向的路段，誰先進就必須誰先出。
 *    後進先出代表後車要穿過前車，實體上不可能。
 * 3. <strong>對向不對開</strong>：同一對節點兩個方向都有人走（場區聯絡線），
 *    兩台車的通過區間不能重疊——那是同一條軌道，對頭開必定互卡。
 *
 * 只比較<strong>至少一方是移動卡</strong>的配對：載客班次彼此之間的站位與班距，已經由
 * 站位碰撞與班距求解處理，這裡補的是移動卡穿過正線的那一塊。
 */

export type TrajectoryKind = 'passenger' | 'move';

export type TrajectoryVisit = {
  nodeId: string;
  nodeLabel: string;
  /** 到達這個節點的時刻（秒，跟卡片同一個時間軸） */
  arriveSecond: number;
  /** 離開這個節點的時刻（秒）；經過不停＝arriveSecond */
  departSecond: number;
};

export type VehicleTrajectory = {
  blockId: string;
  timelineRow: number;
  kind: TrajectoryKind;
  /** 給訊息用：班次代號或卡片標籤 */
  label: string;
  visits: TrajectoryVisit[];
};

export type PathConflictKind = 'node' | 'overtake' | 'head-on';

export type PathConflict = {
  kind: PathConflictKind;
  /** 移動卡那一方（兩方都是移動卡時取時間線較小的） */
  mine: VehicleTrajectory;
  other: VehicleTrajectory;
  /** node：衝突節點；overtake／head-on：路段起點 */
  nodeId: string;
  nodeLabel: string;
  /** overtake／head-on：路段終點 */
  toNodeId?: string;
  toNodeLabel?: string;
  /** mine 在衝突處的時刻（秒） */
  mineSecond: number;
  otherSecond: number;
  /** node：兩段佔用之間的間隔（秒，負數＝重疊） */
  gapSeconds?: number;
};

const DAY_SECONDS = 24 * 60 * 60;

type TopologyIndex = {
  labelById: Map<string, string>;
  nodeIdByLabel: Map<string, string>;
  ambiguousLabels: Set<string>;
  nodeIdByStationId: Map<string, string>;
  edgeByPair: Map<string, PointTopologyEdge>;
  /** 節點 → 實體資源（以 0 秒路段相連的節點是同一處，例如 NW上停1／NW下發1 同一條月台軌道） */
  resourceOf: Map<string, string>;
  resourceLabel: Map<string, string>;
  /** 0 秒相連的點對（雙向，`from>to`） */
  zeroLinked: Set<string>;
};

const indexCache = new WeakMap<PointTopology, TopologyIndex>();

function indexTopology(topology: PointTopology): TopologyIndex {
  const cached = indexCache.get(topology);
  if (cached) return cached;
  const labelById = new Map<string, string>();
  const nodeIdByLabel = new Map<string, string>();
  const ambiguousLabels = new Set<string>();
  const nodeIdByStationId = new Map<string, string>();
  for (const node of topology.nodes) {
    const label = (node.label ?? '').trim();
    labelById.set(node.id, label || node.id);
    if (label) {
      if (nodeIdByLabel.has(label)) ambiguousLabels.add(label);
      else nodeIdByLabel.set(label, node.id);
    }
    const stationId = node.stationId?.trim();
    if (stationId) nodeIdByStationId.set(stationId, node.id);
  }
  const edgeByPair = new Map<string, PointTopologyEdge>();
  for (const edge of topology.edges) edgeByPair.set(`${edge.fromNodeId}>${edge.toNodeId}`, edge);
  /*
   * 0 秒路段兩端是兩個停車位（例：NW上停1 與 NW下發1 很近，但各停一台）。
   * 不合併成同一資源；只記下哪些點是 0 秒相連，折返時車停在到站點、
   * 發車那一刻才走到發車點（與站位佔用模型一致）。
   */
  const zeroLinked = new Set<string>();
  for (const edge of topology.edges) {
    const zero = edgeHasTravelTime(edge) && edgeSeconds(edge, 'avg') <= 0 && edgeSeconds(edge, 'min') <= 0;
    if (!zero) continue;
    zeroLinked.add(`${edge.fromNodeId}>${edge.toNodeId}`);
    zeroLinked.add(`${edge.toNodeId}>${edge.fromNodeId}`);
  }
  const resourceOf = new Map<string, string>(topology.nodes.map((node) => [node.id, node.id]));
  const resourceLabel = new Map<string, string>(
    topology.nodes.map((node) => [node.id, labelById.get(node.id) ?? node.id]),
  );
  const index = {
    labelById, nodeIdByLabel, ambiguousLabels, nodeIdByStationId, edgeByPair, resourceOf, resourceLabel, zeroLinked,
  };
  indexCache.set(topology, index);
  return index;
}

/** 有方向的邊；路網只畫了反方向時退回反方向那條（只拿它的行駛秒數） */
function edgeBetween(index: TopologyIndex, from: string, to: string): PointTopologyEdge | null {
  return index.edgeByPair.get(`${from}>${to}`) ?? index.edgeByPair.get(`${to}>${from}`) ?? null;
}


/** 把途經節點換成實體資源，連續落在同一處的合併成一段佔用 */
function toResources(visits: TrajectoryVisit[], index: TopologyIndex): TrajectoryVisit[] {
  const out: TrajectoryVisit[] = [];
  for (const visit of visits) {
    const resource = index.resourceOf.get(visit.nodeId) ?? visit.nodeId;
    const label = index.resourceLabel.get(resource) ?? visit.nodeLabel;
    const last = out[out.length - 1];
    if (last && last.nodeId === resource) {
      last.departSecond = Math.max(last.departSecond, visit.departSecond);
      continue;
    }
    out.push({ ...visit, nodeId: resource, nodeLabel: label });
  }
  return out;
}

/** 節點所屬的實體資源 id（給軌跡以外的地方對照，例如設施格） */
export function resourceIdOf(topology: PointTopology, nodeId: string): string {
  return indexTopology(topology).resourceOf.get(nodeId) ?? nodeId;
}

/**
 * 一張移動卡自己那一段，在卡上記的途經節點裡的位置 [from, to]（含兩端）。
 *
 * 卡片上的 yardMoveViaLabels 記的是<strong>整趟轉場</strong>的路線（顯示用），但一趟轉場
 * 會拆成兩張連續執行的訂單：整備出廠（設施 → 入口點）＋整備入廠（入口點 → 設施）。
 * 後端（dispatch.yard-moves.ts）各自以 yardExit* 的兩端下單，模擬器各開各的那一段。
 * 照整條路線算的話，出廠卡會在 30 秒內「跑完」整趟、入廠卡又跑一次，同一次移動佔兩次。
 * 排卡、轉折點檢查、路徑檢查都要用這一段，大家看到的才是同一次移動。
 */
export function moveCardOwnSegment(
  block: GeneratedScheduleBlock,
  ids: readonly string[],
  topology: PointTopology,
): [number, number] {
  const index = indexTopology(topology);
  const outbound = block.source !== 'yard_entry_move';
  const facilityId = block.yardExitFacilityNodeId
    ?? (block as { yardEntryFacilityNodeId?: string }).yardEntryFacilityNodeId
    ?? null;
  const stationRaw = block.yardExitStationId ?? null;
  const stationNode = stationRaw
    ? index.nodeIdByStationId.get(stationRaw) ?? (index.labelById.has(stationRaw) ? stationRaw : null)
    : null;
  const ownStart = outbound ? facilityId : stationNode;
  const ownEnd = outbound ? stationNode : facilityId;
  let from = 0;
  let to = ids.length - 1;
  if (ownStart) {
    const at = ids.indexOf(ownStart);
    if (at >= 0) from = at;
  }
  if (ownEnd) {
    const at = ids.lastIndexOf(ownEnd);
    if (at > from) to = at;
  }
  return [from, to];
}

/**
 * 移動卡的軌跡：途經節點照路網平均行駛秒數從卡片開始時刻往下累加
 * （跟 collectMoveJunctionPasses 同一套時刻）。到終點後若卡片還沒結束（提早出場、
 * 到站等下一班），終點的停留延到卡片結束。
 */
export function moveTrajectory(
  block: GeneratedScheduleBlock,
  timelineRow: number,
  topology: PointTopology,
  startSecondOverride?: number,
  /** 班表裡「卡片上的設施名稱 → 節點 id」：地圖改名後用來對回舊名稱，見 {@link facilityAliases} */
  aliases?: ReadonlyMap<string, string>,
): VehicleTrajectory | null {
  if (block.taskType !== 'dispatch') return null;
  let labels = block.yardMoveViaLabels ?? [];
  if (labels.length < 2) return null;
  const index = indexTopology(topology);
  const ids: string[] = [];
  for (const [position, raw] of labels.entries()) {
    const label = raw.trim();
    let id = index.ambiguousLabels.has(label) ? undefined : index.nodeIdByLabel.get(label);
    if (!id && position === 0 && block.yardExitFacilityNodeId && index.labelById.has(block.yardExitFacilityNodeId)) {
      id = block.yardExitFacilityNodeId;
    }
    if (!id) {
      // 名稱對不到：地圖改過名（例：設施 132 從 D1 改叫 H1），卡片上記的名稱是舊的。
      // 用班表裡同名設施記下的節點 id 對回去——節點 id 不會跟著改名變。
      const aliasId = aliases?.get(label);
      if (aliasId && index.labelById.has(aliasId)) id = aliasId;
    }
    if (!id) return null;
    ids.push(id);
  }
  {
    const [from, to] = moveCardOwnSegment(block, ids, topology);
    if (from > 0 || to < ids.length - 1) {
      ids.splice(to + 1);
      ids.splice(0, from);
      labels = labels.slice(from, to + 1);
    }
  }
  if (ids.length < 2) return null;
  const shift = startSecondOverride == null ? 0 : startSecondOverride - minuteToSecond(block.plannedStartMinute);
  const startSecond = minuteToSecond(block.plannedStartMinute) + shift;
  const endSecond = minuteToSecond(block.plannedEndMinute) + shift;
  const visits: TrajectoryVisit[] = [];
  let instant = startSecond;
  visits.push({ nodeId: ids[0]!, nodeLabel: labels[0]!.trim(), arriveSecond: instant, departSecond: instant });
  for (let i = 1; i < ids.length; i += 1) {
    const edge = edgeBetween(index, ids[i - 1]!, ids[i]!);
    if (!edge || !edgeHasTravelTime(edge)) return null;
    instant += edgeSeconds(edge, 'avg');
    visits.push({ nodeId: ids[i]!, nodeLabel: labels[i]!.trim(), arriveSecond: instant, departSecond: instant });
  }
  const last = visits[visits.length - 1]!;
  if (endSecond > last.arriveSecond) last.departSecond = endSecond;
  return {
    blockId: block.id,
    timelineRow,
    kind: 'move',
    label: block.label ?? block.id,
    visits: toResources(visits, index),
  };
}

/**
 * 載客班次的軌跡：各站到離站時刻來自 buildBlockStationDepartures（跟站位碰撞同一套），
 * 站與站之間沿路網最短路展開中途節點，行駛秒數照各段平均秒數的比例分攤到這一段的實際行駛時間。
 */
export function passengerTrajectory(
  block: GeneratedScheduleBlock,
  timelineRow: number,
  selectedRoutes: ShiftScheduleSelectedRoute[] | null | undefined,
  topology: PointTopology,
): VehicleTrajectory | null {
  if (block.taskType !== 'passenger') return null;
  const route = resolveRouteForBlock(block, selectedRoutes);
  if (!route) return null;
  const stops = buildBlockStationDepartures(block, route);
  if (stops.length === 0) return null;
  const index = indexTopology(topology);
  const visits: TrajectoryVisit[] = [];
  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i]!;
    const nodeId = index.nodeIdByStationId.get(stop.stationId);
    if (!nodeId) return null;
    const arrive = minuteToSecond(stop.arrivalMinute);
    const depart = minuteToSecond(stop.departureMinute);
    if (i > 0) {
      const prev = stops[i - 1]!;
      const prevNode = index.nodeIdByStationId.get(prev.stationId)!;
      const path = findTopologyPath(topology, prevNode, nodeId);
      if (path && path.edges.length > 1) {
        const leaveSecond = minuteToSecond(prev.departureMinute);
        const legSeconds = arrive - leaveSecond;
        const weights = path.edges.map((edge) => (edgeHasTravelTime(edge) ? edgeSeconds(edge, 'avg') : 0));
        const total = weights.reduce((sum, value) => sum + value, 0);
        let instant = leaveSecond;
        for (let e = 0; e < path.edges.length - 1; e += 1) {
          instant += total > 0 ? (legSeconds * weights[e]!) / total : legSeconds / path.edges.length;
          const mid = path.edges[e]!.toNodeId;
          visits.push({ nodeId: mid, nodeLabel: index.labelById.get(mid) ?? mid, arriveSecond: instant, departSecond: instant });
        }
      }
    }
    visits.push({
      nodeId,
      nodeLabel: index.labelById.get(nodeId) ?? stop.stationName,
      arriveSecond: arrive,
      departSecond: Math.max(arrive, depart),
    });
  }
  return {
    blockId: block.id,
    timelineRow,
    kind: 'passenger',
    label: block.label ?? block.id,
    visits: toResources(visits, index),
  };
}

/**
 * 班表卡片上「設施名稱 → 節點 id」的對照。卡片的途經名稱是排班當時的地圖名稱，
 * 地圖之後改名（2026-11 設施 D1～D5 改叫 H1～H5）就對不回路網；整備卡與出場卡同時記了
 * 名稱與節點 id，拿它們建對照。
 */
export function facilityAliases(timelines: GeneratedScheduleTimeline[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (block.yardFacilityLabel && block.yardFacilityNodeId) out.set(block.yardFacilityLabel.trim(), block.yardFacilityNodeId);
      if (block.yardExitFacilityLabel && block.yardExitFacilityNodeId) {
        out.set(block.yardExitFacilityLabel.trim(), block.yardExitFacilityNodeId);
      }
    }
  }
  return out;
}

export function collectTrajectories(
  timelines: GeneratedScheduleTimeline[],
  selectedRoutes: ShiftScheduleSelectedRoute[] | null | undefined,
  topology: PointTopology | null | undefined,
): VehicleTrajectory[] {
  if (!topology) return [];
  const aliases = facilityAliases(timelines);
  const index = indexTopology(topology);
  const out: VehicleTrajectory[] = [];
  for (const timeline of timelines) {
    const ordered = timeline.blocks
      .filter((block) => block.source !== 'hold')
      .sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
    let previous: VehicleTrajectory | null = null;
    for (const block of ordered) {
      if (block.plannedEndMinute - block.plannedStartMinute <= 1e-9) continue;
      const trajectory = block.taskType === 'passenger'
        ? passengerTrajectory(block, timeline.row, selectedRoutes, topology)
        : block.taskType === 'dispatch'
          ? moveTrajectory(block, timeline.row, topology, undefined, aliases)
          : null;
      if (!trajectory || trajectory.visits.length === 0) {
        // 停進設施格（整備、待命）：車離開正線了，前一段的停留到此為止
        if (block.taskType !== 'dispatch') previous = null;
        continue;
      }
      /*
       * 車在同一處接著下一段：中間那段車一直停在那裡（終點站折返、出場提早到站等發車）。
       * 不補上的話，兩段之間的月台看起來是空的，別台車可以排進來。
       */
      const tail = previous?.visits[previous.visits.length - 1];
      const head = trajectory.visits[0]!;
      // 到站點與發車點 0 秒相連（終點月台的停靠點 → 發車點）：車停在到站點等，發車才移過去
      const sameSpot = tail
        && (tail.nodeId === head.nodeId || index.zeroLinked.has(`${tail.nodeId}>${head.nodeId}`));
      if (tail && sameSpot && head.arriveSecond >= tail.departSecond) {
        tail.departSecond = head.arriveSecond;
      }
      out.push(trajectory);
      previous = trajectory;
    }
  }
  return out;
}

/** 把 b 的時刻平移整數天，讓它跟 a 在日循環上最接近（跨午夜的卡片時刻會超過 1440 分） */
function alignDay(aSecond: number, bSecond: number): number {
  const days = Math.round((aSecond - bSecond) / DAY_SECONDS);
  return days * DAY_SECONDS;
}

type EdgeTraversal = { from: string; to: string; enter: number; exit: number };

function traversals(trajectory: VehicleTrajectory): EdgeTraversal[] {
  const out: EdgeTraversal[] = [];
  for (let i = 1; i < trajectory.visits.length; i += 1) {
    const a = trajectory.visits[i - 1]!;
    const b = trajectory.visits[i]!;
    if (a.nodeId === b.nodeId) continue;
    out.push({ from: a.nodeId, to: b.nodeId, enter: a.departSecond, exit: b.arriveSecond });
  }
  return out;
}

function span(trajectory: VehicleTrajectory): [number, number] {
  const visits = trajectory.visits;
  return [visits[0]!.arriveSecond, visits[visits.length - 1]!.departSecond];
}

/**
 * 移動車經過一個點時，跟別台車至少要差開幾秒。
 *
 * 就是使用者設定的碰撞保護時間，不再乘 2。乘 2 是站位規則（後車到站 ≥ 前車離站 ＋ 兩倍
 * 保護，見 stationBerthConstraint），先前把它延伸到移動車經過的每一個點（入口點、
 * 轉線點、正線月台），那不是使用者訂的：衝突路口有號誌管，經過一個點只需要物理上的
 * 間隔（2026-11-09 使用者確認）。站位規則本身不受影響。
 */
export function movePassBufferSeconds(collisionProtectionSeconds: number | null | undefined): number {
  return Math.max(0, collisionProtectionSeconds ?? 0);
}

/**
 * 兩條軌跡之間的衝突（不同時間線、至少一方是移動卡）。
 * bufferSeconds：節點佔用至少差開的秒數（2 × 碰撞保護）。
 */
export function conflictsBetween(
  mine: VehicleTrajectory,
  other: VehicleTrajectory,
  bufferSeconds: number,
): PathConflict[] {
  if (mine.timelineRow === other.timelineRow) return [];
  if (mine.kind !== 'move' && other.kind !== 'move') return [];
  const [mStart, mEnd] = span(mine);
  const [oStart0, oEnd0] = span(other);
  const shift = alignDay((mStart + mEnd) / 2, (oStart0 + oEnd0) / 2);
  const oStart = oStart0 + shift;
  const oEnd = oEnd0 + shift;
  // 整段時間都不重疊（含緩衝）就不可能撞
  if (oStart - mEnd >= bufferSeconds || mStart - oEnd >= bufferSeconds) return [];

  const out: PathConflict[] = [];
  for (const a of mine.visits) {
    for (const raw of other.visits) {
      if (raw.nodeId !== a.nodeId) continue;
      const bArrive = raw.arriveSecond + shift;
      const bDepart = raw.departSecond + shift;
      const gap = Math.max(bArrive - a.departSecond, a.arriveSecond - bDepart);
      if (gap < bufferSeconds - 1e-9) {
        out.push({
          kind: 'node', mine, other, nodeId: a.nodeId, nodeLabel: a.nodeLabel,
          mineSecond: a.arriveSecond, otherSecond: bArrive, gapSeconds: gap,
        });
      }
    }
  }
  const mineEdges = traversals(mine);
  const otherEdges = traversals(other).map((t) => ({ ...t, enter: t.enter + shift, exit: t.exit + shift }));
  const labelOf = (id: string) =>
    mine.visits.find((v) => v.nodeId === id)?.nodeLabel ?? other.visits.find((v) => v.nodeId === id)?.nodeLabel ?? id;
  for (const a of mineEdges) {
    for (const b of otherEdges) {
      if (a.from === b.from && a.to === b.to) {
        // 同向：先進先出
        const enterOrder = Math.sign(a.enter - b.enter);
        const exitOrder = Math.sign(a.exit - b.exit);
        if (enterOrder !== 0 && exitOrder !== 0 && enterOrder !== exitOrder) {
          out.push({
            kind: 'overtake', mine, other, nodeId: a.from, nodeLabel: labelOf(a.from),
            toNodeId: a.to, toNodeLabel: labelOf(a.to), mineSecond: a.enter, otherSecond: b.enter,
          });
        }
      } else if (a.from === b.to && a.to === b.from) {
        // 對向：同一條軌道上的通過區間不能重疊
        if (a.enter < b.exit + bufferSeconds && b.enter < a.exit + bufferSeconds) {
          out.push({
            kind: 'head-on', mine, other, nodeId: a.from, nodeLabel: labelOf(a.from),
            toNodeId: a.to, toNodeLabel: labelOf(a.to), mineSecond: a.enter, otherSecond: b.enter,
          });
        }
      }
    }
  }
  return out;
}

/**
 * 給定軌跡集合裡，跟 subject 衝突的所有配對。
 * 用在排卡求解：subject 是候選位置的移動卡，others 是已定案的班次與移動卡。
 */
export function conflictsForTrajectory(
  subject: VehicleTrajectory,
  others: readonly VehicleTrajectory[],
  bufferSeconds: number,
): PathConflict[] {
  const out: PathConflict[] = [];
  for (const other of others) {
    if (other.blockId === subject.blockId) continue;
    out.push(...conflictsBetween(subject, other, bufferSeconds));
  }
  return out;
}

/** 整份班表的路徑衝突（每對只回報一次） */
export function findPathConflicts(
  trajectories: readonly VehicleTrajectory[],
  bufferSeconds: number,
): PathConflict[] {
  const moves = trajectories.filter((t) => t.kind === 'move');
  const out: PathConflict[] = [];
  const seen = new Set<string>();
  for (const mine of moves) {
    for (const other of trajectories) {
      if (other.blockId === mine.blockId) continue;
      if (other.kind === 'move') {
        const key = [mine.blockId, other.blockId].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
      }
      out.push(...conflictsBetween(mine, other, bufferSeconds));
    }
  }
  return out;
}

/**
 * 候選平移量：讓 subject 在每個衝突點剛好閃開對方（貼著緩衝邊緣）。
 * 回傳的是「subject 整條軌跡要平移幾秒」，正數＝往後、負數＝往前，由呼叫端篩選與排序。
 */
export function escapeShiftsFor(conflicts: readonly PathConflict[], bufferSeconds: number): number[] {
  const out = new Set<number>();
  for (const conflict of conflicts) {
    if (conflict.kind === 'node') {
      const mineVisit = conflict.mine.visits.find((v) => v.nodeId === conflict.nodeId);
      const otherVisit = conflict.other.visits.find((v) => v.nodeId === conflict.nodeId);
      if (!mineVisit || !otherVisit) continue;
      const shift = alignDay(mineVisit.arriveSecond, otherVisit.arriveSecond);
      const oArrive = otherVisit.arriveSecond + shift;
      const oDepart = otherVisit.departSecond + shift;
      // 往前：我離開這個點要比對方到達早一個緩衝
      out.add(Math.floor(oArrive - bufferSeconds - mineVisit.departSecond));
      // 往後：我到達這個點要比對方離開晚一個緩衝
      out.add(Math.ceil(oDepart + bufferSeconds - mineVisit.arriveSecond));
    } else {
      const delta = conflict.otherSecond - conflict.mineSecond;
      out.add(Math.floor(delta - bufferSeconds));
      out.add(Math.ceil(delta + bufferSeconds));
    }
  }
  return [...out];
}

/** 衝突的白話描述（給報告與診斷） */
export function describePathConflict(conflict: PathConflict, formatSecond: (second: number) => string): string {
  const who = (t: VehicleTrajectory) => `時間線 ${t.timelineRow}「${t.label}」`;
  if (conflict.kind === 'node') {
    return `${who(conflict.mine)} ${formatSecond(conflict.mineSecond)} 經過「${conflict.nodeLabel}」，`
      + `${who(conflict.other)} ${formatSecond(conflict.otherSecond)} 也在那裡`
      + `（間隔 ${Math.round(conflict.gapSeconds ?? 0)} 秒）`;
  }
  if (conflict.kind === 'overtake') {
    return `${who(conflict.mine)} 與 ${who(conflict.other)} 同向走「${conflict.nodeLabel}」→「${conflict.toNodeLabel}」，`
      + '後進的車要先出，等於要穿過前車';
  }
  return `${who(conflict.mine)} 與 ${who(conflict.other)} 在「${conflict.nodeLabel}」—「${conflict.toNodeLabel}」對向同時通過`;
}
