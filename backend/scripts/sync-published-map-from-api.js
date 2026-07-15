/**
 * 模擬器啟動前：從後端 Map Library API 拉取最新地圖寫入 published-maps。
 * 用法：node scripts/sync-published-map-from-api.js [mapId]
 */
const { writePublishedEntry, DEFAULT_MAP_ID } = require('./map-published-store');

async function syncPublishedMapFromApi(mapId = process.env.ACTIVE_MAP_ID) {
  const base = (
    process.env.SYNC_API
    || process.env.TRANSPORT_API?.replace(/\/demo\/simulation\/?$/, '')
    || 'http://127.0.0.1:3000/syncdrive-api'
  ).replace(/\/$/, '');
  const activeUrl = `${base}/map/library/active`;
  const mapUrl = mapId
    ? `${base}/map/library/${encodeURIComponent(mapId)}`
    : activeUrl;

  try {
    let res = await fetch(activeUrl, { headers: { Accept: 'application/json' } });
    if (!res.ok && mapId && mapUrl !== activeUrl) {
      res = await fetch(mapUrl, { headers: { Accept: 'application/json' } });
    }
    if (!res.ok) {
      console.warn(`[map-sync] ${activeUrl} → HTTP ${res.status}，沿用本機 published / 內建檔`);
      return { ok: false, mapId: mapId || DEFAULT_MAP_ID, status: res.status };
    }
    const body = await res.json();
    if (!body?.mapDocument) {
      console.warn('[map-sync] API 回應缺少 mapDocument');
      return { ok: false, mapId: mapId || DEFAULT_MAP_ID, status: res.status };
    }
    const resolvedMapId = String(body.mapId ?? mapId ?? DEFAULT_MAP_ID);
    writePublishedEntry(resolvedMapId, body);
    const routes = Array.isArray(body.mapDocument.routes) ? body.mapDocument.routes.length : 0;
    console.log(
      `[map-sync] 已同步當前使用地圖 ${resolvedMapId}（${body.displayName ?? resolvedMapId}，路線 ${routes} 條）`,
    );
    return { ok: true, mapId: resolvedMapId, updatedAt: body.updatedAt, routeCount: routes };
  } catch (err) {
    console.warn(`[map-sync] 無法連線 ${activeUrl}：${err.message}，沿用本機 published / 內建檔`);
    return { ok: false, mapId: mapId || DEFAULT_MAP_ID, error: err.message };
  }
}

if (require.main === module) {
  syncPublishedMapFromApi()
    .then((result) => {
      process.exit(result.ok ? 0 : 0);
    })
    .catch((err) => {
      console.error('[map-sync] fatal:', err);
      process.exit(1);
    });
}

module.exports = { syncPublishedMapFromApi };
