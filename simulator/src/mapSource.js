'use strict';

/**
 * 圖資：把站點與場區設施的 id 換成座標。
 *
 * 訂單只給 A/B 點的 id——這是刻意的，中心端不規劃路徑。車輛要自己知道那些 id
 * 在哪裡，這一支就是車輛的那份「地圖」。
 *
 * 座標取 <code>positionMeters</code>，與圖台判讀 <code>local_pose.position</code>
 * 用的是同一個公尺座標系。取 <code>areaPosition</code>（區塊內相對座標）會讓車
 * 全部擠在左上角。
 */

function buildPointIndex(mapPayload) {
  const doc = mapPayload?.mapDocument ?? mapPayload;
  const areas = Array.isArray(doc?.areas) ? doc.areas : [];
  const byId = new Map();

  for (const area of areas) {
    for (const facility of area.facilities ?? []) {
      const position = facility.positionMeters;
      if (!facility.id || !position) continue;
      if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
      byId.set(String(facility.id), {
        id: String(facility.id),
        name: facility.customName || facility.name || String(facility.id),
        type: facility.type,
        areaId: area.id,
        x: position.x,
        y: position.y,
      });
    }
  }

  return byId;
}

class MapSource {
  constructor(mapPayload) {
    this.mapId = mapPayload?.mapId ?? null;
    this.displayName = mapPayload?.displayName ?? null;
    this.version = mapPayload?.version ?? null;
    this.points = buildPointIndex(mapPayload);
  }

  get size() {
    return this.points.size;
  }

  point(id) {
    return id == null ? null : (this.points.get(String(id)) ?? null);
  }

  /**
   * 把訂單的站序換成一條折線。
   *
   * 載客班次帶著完整站序，照著走出來的路徑會貼著實際路線；空車移動只有兩點，
   * 那就是一段直線。查不到座標的點<strong>跳過而不是當成原點</strong>——當成
   * (0,0) 會讓車瞬間飛到圖台角落，比少一個轉折點難查得多。
   */
  polylineFor(order) {
    const ids = [];
    const push = (endpoint) => {
      if (endpoint?.id != null) ids.push(String(endpoint.id));
    };

    const stations = order?.payload?.stations;
    if (Array.isArray(stations) && stations.length >= 2) {
      for (const station of stations) {
        if (station?.station_id != null) ids.push(String(station.station_id));
      }
    } else {
      push(order?.payload?.origin);
      push(order?.payload?.destination);
    }

    const points = [];
    const missing = [];
    for (const id of ids) {
      const point = this.point(id);
      if (point) points.push(point);
      else missing.push(id);
    }
    return { points, missing };
  }
}

module.exports = { MapSource };
