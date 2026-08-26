'use strict';

/**
 * 圖資：把訂單裡的 id 換成座標。
 *
 * 訂單只給 A/B 點的 id——中心端不規劃路徑。車輛要自己知道那些 id 在哪裡，
 * 這一支就是車輛的那份「地圖」。
 *
 * <h3>兩個公尺座標系，只有一個是對的</h3>
 * 圖資裡每個物件都有兩組座標，長得都像公尺：
 *
 * <pre>
 *   positionMeters          圖面座標——畫布上的位置，跟著版面編排走
 *   parameters.refField*M   場域座標——現場真正的位置
 * </pre>
 *
 * 同一個停靠點（N2W下行出發）在前者是 (889, 394)，在後者是 (840, 101.75)。
 * 圖台判讀 <code>local_pose.position</code> 用的是<strong>場域座標</strong>，
 * 取錯的話車子會整批出現在圖外，而且不會有任何錯誤訊息。
 *
 * <h3>三個來源才蓋得全</h3>
 * <pre>
 *   圖資 facilities        設施與停靠點的數字 id（175、131…）
 *   operation-nodes        班表用的站點別名（station_2…）
 *   waypoints              渡線途經點（xo_1_a…）
 * </pre>
 * 訂單的站序三種都會出現，少一個來源就有整段路徑查不到。
 */

function fieldPosition(facility) {
  const parameters = facility?.parameters ?? {};
  // 點狀物件（停靠點、號誌）記單一座標
  if (Number.isFinite(parameters.refFieldXM) && Number.isFinite(parameters.refFieldYM)) {
    return { x: parameters.refFieldXM, y: parameters.refFieldYM };
  }
  // 面狀物件（充電格、停放格）記範圍，取中心
  const { refFieldXMinM, refFieldXMaxM, refFieldYMinM, refFieldYMaxM } = parameters;
  if (
    Number.isFinite(refFieldXMinM) && Number.isFinite(refFieldXMaxM)
    && Number.isFinite(refFieldYMinM) && Number.isFinite(refFieldYMaxM)
  ) {
    return {
      x: (refFieldXMinM + refFieldXMaxM) / 2,
      y: (refFieldYMinM + refFieldYMaxM) / 2,
    };
  }
  return null;
}

class MapSource {
  constructor({ map, operationNodes, waypoints }) {
    this.mapId = map?.mapId ?? null;
    this.displayName = map?.displayName ?? null;
    this.version = map?.version ?? null;
    this.points = new Map();

    const add = (id, entry) => {
      if (id == null) return;
      const key = String(id);
      if (!this.points.has(key)) this.points.set(key, { id: key, ...entry });
    };

    const doc = map?.mapDocument ?? map;
    for (const area of doc?.areas ?? []) {
      for (const facility of area.facilities ?? []) {
        const position = fieldPosition(facility);
        if (!facility.id || !position) continue;
        add(facility.id, {
          name: facility.customName || facility.name || String(facility.id),
          kind: facility.type,
          areaId: area.id,
          ...position,
        });
      }
    }

    // 站點別名。班表與訂單站序用的是這一組，不是設施數字 id。
    for (const node of operationNodes?.nodes ?? []) {
      if (!Number.isFinite(node.xM) || !Number.isFinite(node.yM)) continue;
      const entry = {
        name: node.stationName || node.stationId,
        kind: 'station',
        areaId: node.areaId,
        x: node.xM,
        y: node.yM,
      };
      add(node.stationId, entry);
      add(node.nodeId, entry);
      add(node.facilityId, entry);
    }

    // 渡線途經點。正線班次的站序會經過這些，少了就整段查不到。
    for (const item of waypoints?.items ?? []) {
      if (!Number.isFinite(item.xM) || !Number.isFinite(item.yM)) continue;
      add(item.waypointCode, {
        name: item.alias || item.waypointCode,
        kind: 'waypoint',
        areaId: item.areaId,
        x: item.xM,
        y: item.yM,
      });
    }
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
    const stations = order?.payload?.stations;
    if (Array.isArray(stations) && stations.length >= 2) {
      for (const station of stations) {
        if (station?.station_id != null) ids.push(String(station.station_id));
      }
    } else {
      for (const endpoint of [order?.payload?.origin, order?.payload?.destination]) {
        if (endpoint?.id != null) ids.push(String(endpoint.id));
      }
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

module.exports = { MapSource, fieldPosition };
