'use strict';

/**
 * 沿軌道走的路徑規劃。
 *
 * <h3>為什麼不能兩點直線</h3>
 * 訂單只給 A/B 點，車輛要自己知道怎麼開過去。兩點之間拉直線在數字上沒錯，但
 * 圖台<strong>只認落在軌道段內的座標</strong>——它拿車輛位置去比對每一段軌道的
 * refField 範圍，比不到就判定定位失敗，直接把這台車從畫面上丟掉。
 *
 * 軌道段是很窄的帶（例如下行上排只有 y 100～103.5），直線一離開起點就掉到帶外，
 * 於是整趟沒有任何一幀落在軌道上：車在資料裡好好地跑，畫面上一台都沒有。
 *
 * <h3>做法</h3>
 * 把每一段軌道的中心線當成一條邊，端點當成節點，接起來就是一張圖。要從 A 開到
 * B 時，各自接上最近的節點，中間用 Dijkstra 找最短路。產出的折線每一點都在軌道
 * 中心線上。
 *
 * <pre>
 *   D01…D16  ─────────────  y≈101.75   下行上排
 *   U01…U16  ─────────────  y≈105.25   上行上排
 *   D17…D19  │              x≈101.75   T3 側垂直段
 *   U17…U19  │              x≈105.25
 *   U20…U35  ─────────────  y≈301.75   上行下排
 *   D20…D30  ─────────────  y≈305.25   下行下排
 * </pre>
 *
 * 場區格位（E3、H1…）不在軌道上，那一段用直線接——真車也是離開軌道進格位。
 */

/** 兩個節點視為同一點的容差（公尺）。相鄰軌道段的端點不會剛好等值。 */
const JOIN_TOLERANCE_M = 4;

function key(x, y) {
  return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** 軌道段的中心線：長邊方向就是行車方向 */
function centreLine(box) {
  const width = box.xMax - box.xMin;
  const height = box.yMax - box.yMin;
  if (width >= height) {
    const y = (box.yMin + box.yMax) / 2;
    return [{ x: box.xMin, y }, { x: box.xMax, y }];
  }
  const x = (box.xMin + box.xMax) / 2;
  return [{ x, y: box.yMin }, { x, y: box.yMax }];
}

function collectTrackBoxes(mapPayload) {
  const doc = mapPayload?.mapDocument ?? mapPayload;
  const boxes = [];
  for (const area of doc?.areas ?? []) {
    for (const facility of area.facilities ?? []) {
      if (facility.type !== 'Track') continue;
      const p = facility.parameters ?? {};
      const xMin = p.refFieldXMinM;
      const xMax = p.refFieldXMaxM;
      const yMin = p.refFieldYMinM;
      const yMax = p.refFieldYMaxM;
      if (![xMin, xMax, yMin, yMax].every((v) => Number.isFinite(v))) continue;
      // 退化成一個點的段（例如 T05/T06 那組 y 全為 0）沒有方向，接進圖裡只會製造
      // 假的捷徑，跳過
      if (xMax - xMin <= 0 && yMax - yMin <= 0) continue;
      boxes.push({ code: facility.customName ?? facility.id, xMin, xMax, yMin, yMax });
    }
  }
  return boxes;
}

class TrackGraph {
  constructor(mapPayload) {
    this.nodes = new Map();
    this.adjacency = new Map();

    const boxes = collectTrackBoxes(mapPayload);
    for (const box of boxes) {
      const [a, b] = centreLine(box);
      this.connect(a, b, distance(a, b));
    }

    // 相鄰段的端點不會剛好相同（浮點、以及上下排之間的渡線），容差內就接起來
    const all = [...this.nodes.values()];
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        const d = distance(all[i], all[j]);
        if (d > 0 && d <= JOIN_TOLERANCE_M) this.connect(all[i], all[j], d);
      }
    }
  }

  get size() {
    return this.nodes.size;
  }

  connect(a, b, weight) {
    const ka = key(a.x, a.y);
    const kb = key(b.x, b.y);
    if (!this.nodes.has(ka)) this.nodes.set(ka, { x: a.x, y: a.y, id: ka });
    if (!this.nodes.has(kb)) this.nodes.set(kb, { x: b.x, y: b.y, id: kb });
    if (ka === kb) return;
    if (!this.adjacency.has(ka)) this.adjacency.set(ka, new Map());
    if (!this.adjacency.has(kb)) this.adjacency.set(kb, new Map());
    const prevA = this.adjacency.get(ka).get(kb);
    if (prevA == null || weight < prevA) {
      this.adjacency.get(ka).set(kb, weight);
      this.adjacency.get(kb).set(ka, weight);
    }
  }

  /**
   * 把點投影到最近的<strong>軌道段上</strong>，而不是最近的端點。
   *
   * 只找最近端點的話，車會先往反方向開到那個端點再折回來——畫面上是明顯的
   * 倒車。投影到線段上就從腳下出發。
   */
  nearestOnEdge(point) {
    let best = null;
    for (const [aId, neighbours] of this.adjacency) {
      const a = this.nodes.get(aId);
      for (const bId of neighbours.keys()) {
        if (aId >= bId) continue; // 每條邊只算一次
        const b = this.nodes.get(bId);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSq = dx * dx + dy * dy;
        if (lengthSq <= 0) continue;
        const t = Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq),
        );
        const projected = { x: a.x + dx * t, y: a.y + dy * t };
        const d = distance(point, projected);
        if (!best || d < best.distance) best = { distance: d, a, b, projected };
      }
    }
    return best;
  }

  nearest(point) {
    let best = null;
    let bestDistance = Infinity;
    for (const node of this.nodes.values()) {
      const d = distance(point, node);
      if (d < bestDistance) {
        bestDistance = d;
        best = node;
      }
    }
    return best;
  }

  /** Dijkstra。節點數是數十個等級，不需要優先佇列。 */
  shortestPath(fromId, toId) {
    if (fromId === toId) return [fromId];
    const dist = new Map([[fromId, 0]]);
    const prev = new Map();
    const visited = new Set();

    for (;;) {
      let current = null;
      let currentDistance = Infinity;
      for (const [id, d] of dist) {
        if (!visited.has(id) && d < currentDistance) {
          currentDistance = d;
          current = id;
        }
      }
      if (current == null) return null;
      if (current === toId) break;
      visited.add(current);

      for (const [next, weight] of this.adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        const candidate = currentDistance + weight;
        if (candidate < (dist.get(next) ?? Infinity)) {
          dist.set(next, candidate);
          prev.set(next, current);
        }
      }
    }

    const path = [toId];
    let cursor = toId;
    while (prev.has(cursor)) {
      cursor = prev.get(cursor);
      path.unshift(cursor);
    }
    return path;
  }

  /**
   * 從 A 開到 B 的折線，含起訖點本身。
   *
   * 起訖點若不在軌道上（場區格位），前後各補一段直線接到最近的軌道節點——真車
   * 也是離開軌道進格位。找不到路徑時回 null，由呼叫端決定要不要退回直線。
   */
  route(from, to) {
    if (this.size === 0) return null;

    // 起訖各自投影到最近的軌道段，把投影點當成臨時節點接進圖裡。查完就拆掉，
    // 免得一次查詢的臨時節點污染下一次。
    const startHit = this.nearestOnEdge(from);
    const endHit = this.nearestOnEdge(to);
    if (!startHit || !endHit) return null;

    const temporary = [];
    const addTemp = (hit, label) => {
      const id = `tmp:${label}`;
      this.nodes.set(id, { x: hit.projected.x, y: hit.projected.y, id });
      this.adjacency.set(id, new Map());
      for (const end of [hit.a, hit.b]) {
        const d = distance(hit.projected, end);
        this.adjacency.get(id).set(end.id, d);
        this.adjacency.get(end.id).set(id, d);
      }
      temporary.push(id);
      return id;
    };

    const startId = addTemp(startHit, 'start');
    const endId = addTemp(endHit, 'end');

    let ids;
    try {
      ids = this.shortestPath(startId, endId);
    } finally {
      for (const id of temporary) {
        for (const other of this.adjacency.get(id)?.keys() ?? []) {
          this.adjacency.get(other)?.delete(id);
        }
        this.adjacency.delete(id);
        this.nodes.delete(id);
      }
    }
    if (!ids) return null;

    const points = ids.map((id) => {
      if (id === startId) return { x: startHit.projected.x, y: startHit.projected.y };
      if (id === endId) return { x: endHit.projected.x, y: endHit.projected.y };
      const node = this.nodes.get(id);
      return { x: node.x, y: node.y };
    });

    const out = [from, ...points, to];
    // 去掉重複點：起點剛好落在節點上時會出現兩個一樣的座標
    return out.filter(
      (point, index) => index === 0 || distance(point, out[index - 1]) > 0.05,
    );
  }
}

module.exports = { TrackGraph, centreLine, collectTrackBoxes };
