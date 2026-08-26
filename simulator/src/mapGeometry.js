'use strict';

/**
 * 把圖資整理成「畫得出來、算得動」的幾何。
 *
 * 全部用<strong>場域公尺</strong>（原點左下），與車輛回報的 local_pose、圖台判讀
 * 位置的座標系一致。這一點很重要：路徑編輯器上量到的每一個數字，都要能原封不動
 * 拿去餵車輛，中間不能再換算。
 */

/** 軌道方塊：路徑經過哪些方塊，靠的就是這組範圍 */
function collectTracks(mapPayload) {
  const doc = mapPayload?.mapDocument ?? mapPayload;
  const tracks = [];
  for (const area of doc?.areas ?? []) {
    for (const facility of area.facilities ?? []) {
      if (facility.type !== 'Track') continue;
      const p = facility.parameters ?? {};
      const xMin = p.refFieldXMinM;
      const xMax = p.refFieldXMaxM;
      const yMin = p.refFieldYMinM;
      const yMax = p.refFieldYMaxM;
      if (![xMin, xMax, yMin, yMax].every((v) => Number.isFinite(v))) continue;
      if (xMax - xMin <= 0 && yMax - yMin <= 0) continue;
      tracks.push({
        id: facility.id,
        code: facility.customName ?? facility.name ?? facility.id,
        areaId: area.id,
        xMin,
        xMax,
        yMin,
        yMax,
      });
    }
  }
  return tracks;
}

/** 場域邊界。畫布要照這個等比縮放，不能自己抓 min/max，否則兩張圖比例會不同。 */
function fieldBounds(tracks, points) {
  const xs = [];
  const ys = [];
  for (const t of tracks) {
    xs.push(t.xMin, t.xMax);
    ys.push(t.yMin, t.yMax);
  }
  for (const p of points) {
    xs.push(p.x);
    ys.push(p.y);
  }
  if (xs.length === 0) return { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
  const pad = 20;
  return {
    xMin: Math.min(...xs) - pad,
    xMax: Math.max(...xs) + pad,
    yMin: Math.min(...ys) - pad,
    yMax: Math.max(...ys) + pad,
  };
}

/**
 * 線段與軸對齊矩形的相交區間（Liang–Barsky）。
 *
 * 回傳 <code>[t0, t1]</code>（線段參數 0～1）或 null。要區間而不只是「有沒有相交」，
 * 是因為路徑經過的方塊要<strong>照經過順序</strong>列出來——只知道有碰到，排不出
 * 先後。
 */
function segmentRectRange(ax, ay, bx, by, rect) {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, ax - rect.xMin)) return null;
  if (!clip(dx, rect.xMax - ax)) return null;
  if (!clip(-dy, ay - rect.yMin)) return null;
  if (!clip(dy, rect.yMax - ay)) return null;
  return t0 <= t1 ? [t0, t1] : null;
}

/**
 * 折線經過了哪些軌道方塊，照經過順序。
 *
 * 同一個方塊在路徑上出現兩次（折返）時會列兩次——那是實際情況，去重反而會讓
 * 後面的人以為車只經過一次。
 */
function tracksAlongPath(points, tracks) {
  const hits = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const onThisLeg = [];
    for (const track of tracks) {
      const range = segmentRectRange(a.x, a.y, b.x, b.y, track);
      if (!range) continue;
      onThisLeg.push({ track, enter: range[0], exit: range[1] });
    }
    onThisLeg.sort((m, n) => m.enter - n.enter);
    for (const hit of onThisLeg) {
      const previous = hits[hits.length - 1];
      // 連續兩段都在同一個方塊裡時只記一次——那是同一次經過被線段切開
      if (previous && previous.id === hit.track.id && previous.legIndex === i - 1) {
        previous.legIndex = i;
        continue;
      }
      if (previous && previous.id === hit.track.id && previous.legIndex === i) continue;
      hits.push({
        id: hit.track.id,
        code: hit.track.code,
        areaId: hit.track.areaId,
        legIndex: i,
        refField: {
          xMinM: hit.track.xMin,
          xMaxM: hit.track.xMax,
          yMinM: hit.track.yMin,
          yMaxM: hit.track.yMax,
        },
      });
    }
  }
  return hits;
}

/**
 * 折線切成等距路徑點。
 *
 * 車輛照這些點走，所以間距要夠密才不會切過彎——但也不必太密，車端本來就會在
 * 兩點之間插值。轉折處一定保留原始頂點，不然折角會被抹平。
 */
function samplePath(points, stepMeters = 5) {
  if (points.length === 0) return [];
  const out = [{ x: points[0].x, y: points[0].y }];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(length / stepMeters));
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

function pathLength(points) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return total;
}


/**
 * 給編輯器畫圖用的<strong>像素版面</strong>。
 *
 * <h3>為什麼不用場域公尺畫</h3>
 * 場域座標與圖面座標<strong>不是單一線性關係</strong>（實測最大誤差 685 公尺）：
 * 每個區塊各自對應自己那一段現場。照場域公尺直接畫，出來的東西和圖台上看到的
 * 完全不像——軌道會變成細線、站台的相對位置全跑掉。
 *
 * 所以畫圖用圖資本來的像素版面（區塊 layout ＋ 設施 areaPosition／areaSizePx），
 * 那正是圖台在做的事，看起來就會一樣。<strong>存檔時再逐方塊換回場域公尺</strong>。
 */
function buildCanvas(mapPayload) {
  const doc = mapPayload?.mapDocument ?? mapPayload;
  const areas = [];
  const facilities = [];

  for (const area of doc?.areas ?? []) {
    const layout = area.layout ?? {};
    areas.push({
      id: area.id,
      name: area.customName ?? area.id,
      x: layout.xPx ?? 0,
      y: layout.yPx ?? 0,
      w: layout.wPx ?? 0,
      h: layout.hPx ?? 0,
    });

    for (const facility of area.facilities ?? []) {
      const pos = facility.areaPosition;
      const size = facility.areaSizePx;
      if (!pos || !size) continue;
      const p = facility.parameters ?? {};
      const field = [p.refFieldXMinM, p.refFieldXMaxM, p.refFieldYMinM, p.refFieldYMaxM]
        .every((v) => Number.isFinite(v))
        ? {
          xMinM: p.refFieldXMinM,
          xMaxM: p.refFieldXMaxM,
          yMinM: p.refFieldYMinM,
          yMaxM: p.refFieldYMaxM,
        }
        : null;
      facilities.push({
        id: facility.id,
        type: facility.type,
        code: facility.customName ?? facility.name ?? '',
        areaId: area.id,
        // 絕對像素：區塊左上角 ＋ 設施在區塊內的位置
        x: (layout.xPx ?? 0) + pos.x,
        /*
         * areaPosition 的原點在區塊<strong>左下角、y 向上</strong>（見前端
         * areaPositionToCssTopLeft），CSS 的 top 是由上往下。直接相加會讓每個設施
         * 的 y 都翻過來，症狀是站點與路徑通通浮在兩排軌道中間的空白處。
         */
        y: (layout.yPx ?? 0) + ((layout.hPx ?? 0) - pos.y - size.h),
        w: size.w,
        h: size.h,
        rotationDeg: facility.rotationDeg ?? facility.rotation ?? 0,
        fill: typeof p.defaultFillColor === 'string' ? p.defaultFillColor : null,
        field,
        // 點狀設施（停靠點、號誌）記的是單一座標而不是範圍
        fieldPoint:
          Number.isFinite(p.refFieldXM) && Number.isFinite(p.refFieldYM)
            ? { xM: p.refFieldXM, yM: p.refFieldYM }
            : null,
      });
    }
  }

  return {
    pixelSize: doc?.pixelSize ?? { width: 3152, height: 642 },
    areas,
    facilities,
  };
}

/**
 * 場區格位：充電 E、洗車 W、調度 H、保養 M。
 *
 * 車輛沒有訂單時就停在這裡。這很重要——沒有位置就發不出 telemetry，圖台上那台車
 * 等於不存在，要等到它第一次接單才會憑空冒出來。真實的車就算停著也一直在回報。
 *
 * 取格位的<strong>中心</strong>，不是角落：角落會讓車圖示壓在格線上。
 */
function collectYardSlots(mapPayload) {
  const doc = mapPayload?.mapDocument ?? mapPayload;
  const slots = [];
  for (const area of doc?.areas ?? []) {
    for (const facility of area.facilities ?? []) {
      const code = facility.customName ?? facility.name ?? '';
      if (!/^[EPWHM]\d+$/.test(code)) continue;
      const p = facility.parameters ?? {};
      const box = [p.refFieldXMinM, p.refFieldXMaxM, p.refFieldYMinM, p.refFieldYMaxM];
      if (!box.every((v) => Number.isFinite(v))) continue;
      slots.push({
        code,
        id: facility.id,
        x: (p.refFieldXMinM + p.refFieldXMaxM) / 2,
        y: (p.refFieldYMinM + p.refFieldYMaxM) / 2,
      });
    }
  }
  // 依代號排序，讓每次啟動的分配都一樣——車每次開機停在不同地方很難對照
  slots.sort((a, b) => a.code.localeCompare(b.code));
  return slots;
}

/**
 * 橫渡線：兩端場域座標已知的一條斜向連接。
 *
 * 軌道方塊有「參照場域<strong>範圍</strong>」，橫渡線沒有——它記的是兩個 portal 的
 * 精確場域座標（<code>refFieldXM/refFieldYM</code>），各自貼在一條軌道上。
 * 車要從上行換到下行就是走這一段，所以路徑一定會壓過這裡；少了這一段，
 * 走 cross 的點就換算不出場域座標。
 *
 * portal 的位置存的是<strong>區塊 domain 公尺</strong>（不是場域公尺，也不是像素），
 * 所以要照該區塊的 domain↔layout 比例換成像素。
 */
function collectCrossovers(mapPayload) {
  const doc = mapPayload?.mapDocument ?? mapPayload;
  const out = [];

  for (const area of doc?.areas ?? []) {
    const layout = area.layout ?? {};
    const domain = area.domain;
    if (!domain) continue;
    const spanX = domain.xMaxM - domain.xMinM;
    const spanY = domain.yMaxM - domain.yMinM;
    if (!(spanX > 0) || !(spanY > 0)) continue;

    // domain 公尺 → 絕對像素。原點在區塊左下、y 向上，與設施的 areaPosition 同一套。
    const toPixel = (xM, yM) => ({
      x: (layout.xPx ?? 0) + ((xM - domain.xMinM) / spanX) * (layout.wPx ?? 0),
      y: (layout.yPx ?? 0) + (layout.hPx ?? 0) - ((yM - domain.yMinM) / spanY) * (layout.hPx ?? 0),
    });

    for (const facility of area.facilities ?? []) {
      if (facility.type !== 'TrackCrossover') continue;
      const portals = facility.parameters?.trackCrossoverPortals;
      const a = portals?.a;
      const b = portals?.b;
      if (!a || !b) continue;
      if (![a.xM, a.yM, b.xM, b.yM, a.refFieldXM, a.refFieldYM, b.refFieldXM, b.refFieldYM]
        .every((v) => Number.isFinite(v))) continue;

      const pa = toPixel(a.xM, a.yM);
      const pb = toPixel(b.xM, b.yM);
      out.push({
        id: facility.id,
        code: facility.customName ?? facility.name ?? facility.id,
        areaId: area.id,
        a: { px: pa.x, py: pa.y, xM: a.refFieldXM, yM: a.refFieldYM, alias: a.alias ?? null },
        b: { px: pb.x, py: pb.y, xM: b.refFieldXM, yM: b.refFieldYM, alias: b.alias ?? null },
      });
    }
  }

  return out;
}

/** 點到線段的投影參數 t（0～1）與距離 */
function projectOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0) return { t: 0, distance: Math.hypot(px - ax, py - ay) };
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { t, distance: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) };
}

/** 走橫渡線的點：投影到 portal 連線上，再依比例內插兩端的場域座標 */
function crossoverFieldAt(crossovers, px, py, tolerancePx) {
  let best = null;
  for (const xo of crossovers) {
    const hit = projectOnSegment(px, py, xo.a.px, xo.a.py, xo.b.px, xo.b.py);
    if (hit.distance > tolerancePx) continue;
    if (!best || hit.distance < best.hit.distance) best = { xo, hit };
  }
  if (!best) return null;
  const { xo, hit } = best;
  return {
    x: xo.a.xM + (xo.b.xM - xo.a.xM) * hit.t,
    y: xo.a.yM + (xo.b.yM - xo.a.yM) * hit.t,
    facilityId: xo.id,
    code: xo.code,
    viaCrossover: true,
  };
}

/**
 * 圖面像素 → 場域公尺。
 *
 * 逐方塊換算：找出指標落在哪一個有場域範圍的方塊裡，再依比例映射進那個方塊的
 * 場域範圍。<strong>這正是圖台判讀車輛位置的反向操作</strong>，所以編輯器上量到
 * 的數字，車輛拿去用會落在同一個地方。
 *
 * 方塊都沒中就試橫渡線：那裡沒有「範圍」，但兩端 portal 的場域座標是精確的，
 * 投影到兩者連線上內插即可。走 cross 的路徑點都落在這裡。
 *
 * 兩者都不中才回 null——那裡真的沒有定義的場域座標。呼叫端不該自己編一個數字。
 */
function pixelToField(facilities, px, py, crossovers = [], tolerancePx = 24) {
  /*
   * 橫渡線優先，而且只在「幾乎壓在線上」時優先。
   *
   * 橫渡線是斜的，一定會穿過幾條水平軌道帶。同一個點兩種答案都算得出來：照軌道帶
   * 算會得到那條帶的 y，照橫渡線算會得到轉線途中的 y。車在這裡是<strong>正在轉線</strong>，
   * 不是待在那條帶上，所以答案是橫渡線。
   *
   * 先前沒有這個優先序，於是一條斜線上的點有些判給帶、有些判給橫渡線——每一段各自
   * 平滑，接起來卻是來回跳的（實測 715→690→720→740）。存出去的路徑點會忽前忽後，
   * 車輛就照著倒退的座標開。
   */
  const onCrossover = crossoverFieldAt(crossovers, px, py, 8);
  if (onCrossover) return onCrossover;

  for (const f of facilities) {
    if (!f.field) continue;
    if (px < f.x || px > f.x + f.w || py < f.y || py > f.y + f.h) continue;
    const tx = f.w > 0 ? (px - f.x) / f.w : 0.5;
    // 像素 y 向下、場域 y 向上
    const ty = f.h > 0 ? (py - f.y) / f.h : 0.5;
    return {
      x: f.field.xMinM + (f.field.xMaxM - f.field.xMinM) * tx,
      y: f.field.yMaxM - (f.field.yMaxM - f.field.yMinM) * ty,
      facilityId: f.id,
      code: f.code,
    };
  }

  // 方塊也沒中：手畫的折線點不必正中橫渡線，放寬一點
  return crossoverFieldAt(crossovers, px, py, tolerancePx);
}

/** 場域公尺 → 圖面像素。找出哪個方塊的場域範圍含這個點，再反算。 */
function fieldToPixel(facilities, xM, yM) {
  for (const f of facilities) {
    if (!f.field) continue;
    const { xMinM, xMaxM, yMinM, yMaxM } = f.field;
    if (xM < xMinM || xM > xMaxM || yM < yMinM || yM > yMaxM) continue;
    const tx = xMaxM > xMinM ? (xM - xMinM) / (xMaxM - xMinM) : 0.5;
    const ty = yMaxM > yMinM ? (yMaxM - yM) / (yMaxM - yMinM) : 0.5;
    return { x: f.x + f.w * tx, y: f.y + f.h * ty, facilityId: f.id };
  }
  return null;
}

module.exports = {
  buildCanvas,
  collectCrossovers,
  collectYardSlots,
  pixelToField,
  fieldToPixel,
  collectTracks,
  fieldBounds,
  segmentRectRange,
  tracksAlongPath,
  samplePath,
  pathLength,
};
