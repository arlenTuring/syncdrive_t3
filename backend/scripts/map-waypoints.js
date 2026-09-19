/**
 * 從 MapFileV2 擷取途經點：
 * - kind: 'waypoint'＝一般途經點（Waypoint 設施）
 * - kind: 'cross-waypoint'＝交叉軌道四口途經點（RailCross 的 lt／rb／lb／rt）
 * 兩者功能相同（可入路線／拓樸），資料來源與分類分開。
 */
const fs = require('fs');
const path = require('path');

const { resolveMapJsonPath } = require('./map-operation-nodes');

/** 現場座標優先，沒有就退回圖面座標 */
function fieldMeter(refField, canvas) {
  if (typeof refField === 'number' && Number.isFinite(refField)) return refField;
  return typeof canvas === 'number' && Number.isFinite(canvas) ? canvas : undefined;
}

function normalizeCode(raw) {
  return String(raw ?? '').trim();
}

function loadWaypointsFromMapFile(mapPath) {
  const raw = fs.readFileSync(mapPath, 'utf8');
  const map = JSON.parse(raw);
  const areas = Array.isArray(map.areas) ? map.areas : [];
  const items = [];

  for (const area of areas) {
    const facilities = Array.isArray(area.facilities) ? area.facilities : [];
    for (const entry of facilities) {
      const type = String(entry.type ?? '').trim();
      if (type === 'Waypoint') {
        const waypointCode = normalizeCode(entry.parameters?.waypointCode);
        if (!waypointCode) continue;

        items.push({
          waypointCode,
          facilityId: String(entry.id ?? ''),
          areaId: String(area.id ?? ''),
          areaName: String(area.customName ?? area.id ?? ''),
          kind: 'waypoint',
          kindLabel: '途經點',
          /*
           * 使用者取的名字也一起送出去。
           *
           * 途經點的 waypointCode 是系統流水號（WP1、WP2…），畫圖的人記得的是自己打的
           * 「整備調度入口點」。下拉只給代號的話，等於要人背哪個號碼是哪個入口。
           */
          alias: normalizeCode(entry.customName) || undefined,
          // 現場座標。要算「這個入口點離哪一格近」得有座標。
          xM: fieldMeter(
            entry.parameters?.refFieldXM,
            entry.position?.x,
          ),
          yM: fieldMeter(
            entry.parameters?.refFieldYM,
            entry.position?.y,
          ),
        });
        continue;
      }

      /*
       * 交叉軌道的四個口。
       *
       * 生成式圖資裡的分岔是 RailCross（type 仍是 Track），四個口掛在
       * crossTrackPortals。路線編輯器讀得到它們（正線路線的站序裡就有
       * n2w_u2d_back_start 這種），這支 API 也要給。
       */
      const crossPortals = entry.parameters?.crossTrackPortals;
      if (crossPortals && typeof crossPortals === 'object') {
        // 屬性框的顯示順序：左上 → 右下 → 左下 → 右上（兩條斜線各自的頭尾）
        for (const portalKey of ['lt', 'rb', 'lb', 'rt']) {
          const portal = crossPortals[portalKey];
          if (!portal || typeof portal !== 'object') continue;
          const waypointCode = normalizeCode(portal.waypointCode);
          if (!waypointCode) continue;
          items.push({
            waypointCode,
            facilityId: String(entry.id ?? ''),
            areaId: String(area.id ?? ''),
            areaName: String(area.customName ?? area.id ?? ''),
            kind: 'cross-waypoint',
            kindLabel: '交叉軌道途經點',
            portalKey,
            topologyNodeId: `xcwp:${String(entry.id ?? '')}:${portalKey}`,
            alias: normalizeCode(portal.alias) || undefined,
            // 四個口的座標在圖資裡是空的（由相鄰軌道端點反推），沒有就不送。
            xM: fieldMeter(portal.refFieldXM, portal.xM),
            yM: fieldMeter(portal.refFieldYM, portal.yM),
          });
        }
        continue;
      }
    }
  }

  items.sort((a, b) =>
    a.waypointCode.localeCompare(b.waypointCode, undefined, { numeric: true }),
  );

  return {
    mapId: map.mapId ?? path.basename(mapPath, '.json'),
    items,
  };
}

function loadWaypoints(mapId) {
  const mapPath = resolveMapJsonPath(mapId);
  if (!mapPath) return null;
  return loadWaypointsFromMapFile(mapPath);
}

module.exports = {
  loadWaypoints,
  loadWaypointsFromMapFile,
};
