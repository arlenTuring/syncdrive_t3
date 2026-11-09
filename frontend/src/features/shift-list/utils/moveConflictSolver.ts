import type { VehicleTrajectory } from './pathOccupancy';

/**
 * 移動卡衝突消解：替代圖（Alternative Graph）
 * ========================================
 *
 * 鐵路調度的標準衝突模型（Mascis & Pacciarelli 2002，阻塞型工作排程 blocking job shop）：
 * 每台車是一串依序佔用資源（節點、路段）的作業；任兩台車用到同一個資源，就是一組
 * <strong>二選一</strong>——「我先過」或「你先過」，兩者都要差開安全間隔。選定每一組
 * 二選一（一個 selection）之後，所有限制都變成時刻之間的差分不等式。
 *
 * 這裡的「工作」是一串首尾相接的移動卡，整串只能<strong>剛性平移</strong> δ 秒（車在路上
 * 不會中途停下來等），δ 落在這串自己的可挪範圍內。載客班次與沒參與的移動卡是固定的
 * 背景交通（載客優先，時刻不動）。在這個前提下：
 *
 * - 跟固定交通的每一組二選一，都變成 δ 的一段<strong>禁止區間</strong>；扣完之後剩下的
 *   每一段可行區間，恰好對應一組一致的先後選擇。
 * - 兩串移動卡之間的二選一，變成 δ_i − δ_j 的禁止區間。
 *
 * 求解用分支定界：一次決定一串，分支＝它目前的每一段可行區間（取區間內最接近 0 的點，
 * 調度車盡量照原時刻），先試平移量小的；下界＝已定的平移量＋其餘各串在固定交通下
 * 最小可能的平移量。目標是字典序：先全部可行（安全是硬限制），再總平移量最小。
 * 找不到全部可行的解時回傳 null，由呼叫端退回逐串修復並如實回報。
 */

export type ShiftVariable = {
  key: string;
  /** 這串所屬的時間線（同一台車的其他卡不算衝突對象） */
  timelineRow: number;
  /** 這串移動卡的軌跡（平移 0 時） */
  trajectories: VehicleTrajectory[];
  /** 最後一站的離站時刻固定（提早到站後在站上等到下一班發車），不隨平移變動 */
  fixedLastDepartSecond: number | null;
  /** 出發前停在哪一格、從幾點開始停（停放結束＝出發，跟著平移） */
  parkedBefore?: { resource: string; fromSecond: number } | null;
  /** 抵達後停進哪一格、停到幾點（停放開始＝抵達，跟著平移） */
  parkedAfter?: { resource: string; untilSecond: number } | null;
  min: number;
  max: number;
};

type Interval = [number, number];

const DAY = 24 * 60 * 60;
const GRID = 10;
const INF = Number.POSITIVE_INFINITY;

type Visit = { node: string; a: number; d: number; dFixed: boolean; aFixed?: boolean };
type Edge = { from: string; to: string; enter: number; exit: number };

function visitsOf(variable: ShiftVariable): Visit[] {
  const out: Visit[] = [];
  const first = variable.trajectories[0]?.visits[0];
  if (variable.parkedBefore && first) {
    out.push({
      node: variable.parkedBefore.resource, a: variable.parkedBefore.fromSecond, d: first.departSecond,
      aFixed: true, dFixed: false,
    });
  }
  const lastTrajectory = variable.trajectories[variable.trajectories.length - 1];
  for (const trajectory of variable.trajectories) {
    trajectory.visits.forEach((visit, index) => {
      const isFinal = trajectory === lastTrajectory && index === trajectory.visits.length - 1;
      const fixed = isFinal && variable.fixedLastDepartSecond != null;
      out.push({
        node: visit.nodeId,
        a: visit.arriveSecond,
        d: fixed ? Math.max(visit.departSecond, variable.fixedLastDepartSecond!) : visit.departSecond,
        dFixed: fixed,
      });
    });
  }
  const tail = variable.trajectories[variable.trajectories.length - 1]?.visits.at(-1);
  if (variable.parkedAfter && tail) {
    out.push({
      node: variable.parkedAfter.resource, a: tail.arriveSecond, d: variable.parkedAfter.untilSecond,
      dFixed: true,
    });
  }
  return out;
}

function edgesOf(trajectories: VehicleTrajectory[]): Edge[] {
  const out: Edge[] = [];
  for (const trajectory of trajectories) {
    for (let index = 1; index < trajectory.visits.length; index += 1) {
      const a = trajectory.visits[index - 1]!;
      const b = trajectory.visits[index]!;
      if (a.nodeId !== b.nodeId) out.push({ from: a.nodeId, to: b.nodeId, enter: a.departSecond, exit: b.arriveSecond });
    }
  }
  return out;
}

/**
 * 我（平移 δ）跟一段固定的佔用 [oa, od] 在同一個節點：會撞的 δ 範圍（開區間）。
 * 我的佔用是 [a+δ, d+δ]；最後一站若離站固定則是 [a+δ, D]。
 */
function nodeForbidden(mine: Visit, oa: number, od: number, buffer: number): Interval | null {
  // 撞上 ⇔ 對方到達 − 我離開 < 緩衝，且 我到達 − 對方離開 < 緩衝
  if (mine.aFixed && mine.dFixed) {
    return oa - mine.d < buffer && mine.a - od < buffer ? [-INF, INF] : null;
  }
  if (mine.dFixed) {
    // 離站固定：對方在我離開後一個緩衝才到就永遠不撞；否則我必須在對方離開後一個緩衝才到
    if (oa - mine.d >= buffer) return null;
    return [-INF, od + buffer - mine.a];
  }
  if (mine.aFixed) {
    // 到達固定（停放開始）：我到之前對方早就走了就不撞；否則我必須在對方到之前一個緩衝就離開
    if (mine.a - od >= buffer) return null;
    return [oa - buffer - mine.d, INF];
  }
  return [oa - buffer - mine.d, od + buffer - mine.a];
}

/** 同向同一段路：我（平移 δ）跟對方的進出順序不同就是超車 */
function overtakeForbidden(mine: Edge, other: Edge): Interval | null {
  const lo = Math.min(other.enter - mine.enter, other.exit - mine.exit);
  const hi = Math.max(other.enter - mine.enter, other.exit - mine.exit);
  // 端點也不行：一端同時進（或同時出）、另一端先後不同，一樣是兩車擠在同一處
  return hi > lo ? [lo - 1, hi + 1] : null;
}

/** 對向同一條軌道：通過區間（含緩衝）不能重疊 */
function headOnForbidden(mine: Edge, other: Edge, buffer: number): Interval {
  return [other.enter - buffer - mine.exit, other.exit + buffer - mine.enter];
}

/** 一串（平移 δ）對一條固定軌跡的所有禁止區間；固定軌跡試 −1、0、+1 天三個副本（跨午夜） */
function forbiddenAgainstFixed(
  visits: Visit[],
  edges: Edge[],
  other: VehicleTrajectory,
  buffer: number,
): Interval[] {
  const out: Interval[] = [];
  const otherEdges = edgesOf([other]);
  for (const day of [-DAY, 0, DAY]) {
    for (const mine of visits) {
      for (const visit of other.visits) {
        if (visit.nodeId !== mine.node) continue;
        const interval = nodeForbidden(mine, visit.arriveSecond + day, visit.departSecond + day, buffer);
        if (interval) out.push(interval);
      }
    }
    for (const mine of edges) {
      for (const raw of otherEdges) {
        const otherEdge = { ...raw, enter: raw.enter + day, exit: raw.exit + day };
        if (mine.from === otherEdge.from && mine.to === otherEdge.to) {
          const interval = overtakeForbidden(mine, otherEdge);
          if (interval) out.push(interval);
        } else if (mine.from === otherEdge.to && mine.to === otherEdge.from) {
          out.push(headOnForbidden(mine, otherEdge, buffer));
        }
      }
    }
  }
  return out;
}

/** 兩串之間：δ_i − δ_j 不能落在的區間（把 j 當成平移 0 的固定軌跡來算） */
function pairForbidden(i: ShiftVariable, j: ShiftVariable, buffer: number): Interval[] {
  const visits = visitsOf(i);
  const edges = edgesOf(i.trajectories);
  const out: Interval[] = [];
  for (const trajectory of j.trajectories) out.push(...forbiddenAgainstFixed(visits, edges, trajectory, buffer));
  return out;
}

/** 可行點：落在 [min,max]、10 秒格上、不在任何禁止開區間內；每段可行區間取最接近 0 的一點 */
function feasiblePoints(min: number, max: number, forbidden: Interval[]): number[] {
  const lo0 = Math.ceil(min / GRID) * GRID;
  const hi0 = Math.floor(max / GRID) * GRID;
  if (hi0 < lo0) return [];
  // 禁止開區間 (l, h) 在格上等於禁止 [floor(l)+GRID, ceil(h)-GRID]
  const blocks = forbidden
    .map(([l, h]) => [
      l === -INF ? -INF : Math.floor(l / GRID) * GRID + GRID,
      h === INF ? INF : Math.ceil(h / GRID) * GRID - GRID,
    ] as Interval)
    .filter(([l, h]) => h >= l && h >= lo0 && l <= hi0)
    .sort((a, b) => a[0] - b[0]);
  const free: Interval[] = [];
  let cursor = lo0;
  for (const [l, h] of blocks) {
    if (l > cursor) free.push([cursor, Math.min(l - GRID, hi0)]);
    cursor = Math.max(cursor, h + GRID);
    if (cursor > hi0) break;
  }
  if (cursor <= hi0) free.push([cursor, hi0]);
  return free
    .filter(([l, h]) => h >= l)
    .map(([l, h]) => (l > 0 ? l : h < 0 ? h : 0))
    .sort((a, b) => Math.abs(a) - Math.abs(b));
}

export type SolveResult = {
  shifts: Map<string, number>;
  cost: number;
  nodes: number;
  /** 光是固定交通就把可挪範圍全部擋死的串：靠平移調度車解不了，留在原時刻當背景交通 */
  unsolvable: string[];
};

export function solveMoveShifts(args: {
  variables: ShiftVariable[];
  /** 固定的背景交通（載客班次、沒參與的移動卡） */
  fixed: VehicleTrajectory[];
  bufferSeconds: number;
  nodeBudget?: number;
}): SolveResult | null {
  const { bufferSeconds: buffer } = args;
  const budget = args.nodeBudget ?? 20_000;
  let variables = args.variables;
  let fixed = args.fixed;
  const unsolvable: string[] = [];
  // 光是固定交通就無解的串移到背景交通（留在原時刻），其他串要閃開它；重複到穩定
  for (let round = 0; round < 4; round += 1) {
    const dead = variables.filter((variable) => feasiblePoints(
      variable.min, variable.max, againstFixed(variable, fixed, buffer),
    ).length === 0);
    if (dead.length === 0) break;
    unsolvable.push(...dead.map((variable) => variable.key));
    fixed = [...fixed, ...dead.flatMap((variable) => variable.trajectories)];
    variables = variables.filter((variable) => !dead.includes(variable));
  }
  if (variables.length === 0) return { shifts: new Map(), cost: 0, nodes: 0, unsolvable };

  const base = variables.map((variable) => againstFixed(variable, fixed, buffer));
  const baseOptions = variables.map((variable, index) => feasiblePoints(variable.min, variable.max, base[index]!));
  const pair = variables.map((vi) => variables.map((vj) => (
    vi === vj || vi.timelineRow === vj.timelineRow ? [] : pairForbidden(vi, vj, buffer)
  )));

  // 選項少的先決定（最受限的先分支）
  const order = variables.map((_, index) => index).sort((a, b) => baseOptions[a]!.length - baseOptions[b]!.length);
  const minCost = baseOptions.map((options) => Math.abs(options[0]!));
  const assigned = new Map<number, number>();
  let best: { values: Map<number, number>; cost: number } | null = null;
  let nodes = 0;

  const search = (depth: number, cost: number): void => {
    if (nodes >= budget) return;
    nodes += 1;
    if (depth === order.length) {
      if (!best || cost < best.cost) best = { values: new Map(assigned), cost };
      return;
    }
    let bound = cost;
    for (let k = depth; k < order.length; k += 1) bound += minCost[order[k]!]!;
    if (best && bound >= best.cost) return;
    const index = order[depth]!;
    const variable = variables[index]!;
    const forbidden = [...base[index]!];
    for (const [other, value] of assigned) {
      // δ_i − δ_j ∉ (l, h)  ⇔  δ_i ∉ (l + δ_j, h + δ_j)
      for (const [l, h] of pair[index]![other]!) forbidden.push([l + value, h + value]);
    }
    for (const value of feasiblePoints(variable.min, variable.max, forbidden)) {
      assigned.set(index, value);
      search(depth + 1, cost + Math.abs(value));
      assigned.delete(index);
      if (nodes >= budget) break;
    }
  };
  search(0, 0);
  if (!best) return null;
  const found = best as { values: Map<number, number>; cost: number };
  const shifts = new Map<string, number>();
  for (const [index, value] of found.values) shifts.set(variables[index]!.key, value);
  return { shifts, cost: found.cost, nodes, unsolvable };
}

/** 一串對固定交通的禁止區間（只跟時間上可能碰到的比） */
function againstFixed(variable: ShiftVariable, fixed: readonly VehicleTrajectory[], buffer: number): Interval[] {
  const visits = visitsOf(variable);
  const edges = edgesOf(variable.trajectories);
  const start = Math.min(...visits.map((v) => v.a)) + variable.min - buffer;
  const end = Math.max(...visits.map((v) => v.d)) + variable.max + buffer;
  const out: Interval[] = [];
  for (const other of fixed) {
    if (other.timelineRow === variable.timelineRow) continue;
    const first = other.visits[0]!.arriveSecond;
    const last = other.visits[other.visits.length - 1]!.departSecond;
    const near = [-DAY, 0, DAY].some((day) => first + day <= end && last + day >= start);
    if (!near) continue;
    out.push(...forbiddenAgainstFixed(visits, edges, other, buffer));
  }
  return out;
}

export const moveConflictSolverInternals = { feasiblePoints, nodeForbidden, overtakeForbidden };
