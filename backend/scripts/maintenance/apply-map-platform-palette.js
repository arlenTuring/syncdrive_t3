#!/usr/bin/env node
'use strict';

/**
 * 圖台改色：把地圖圖資的「樣式欄位」換成圖台色票，其他一律不動。
 * =====================================================
 *
 * 色票來源：frontend/src/features/dashboard/constants/mapPlatformTheme.ts（同一份數值，改一邊要改另一邊）。
 *
 * 只換「舊預設色」：認得的舊顏色才換，使用者自己調過的顏色原樣保留；跑第二次不會再變（冪等）。
 * 會動的欄位（白名單）：
 * <ul>
 *   <li>Track：defaultFillColor（沒設的補上，填色透明度 0 的純虛線除外）、strokeColor、trackGenPartColors.up／down、labelStyle.color；</li>
 *   <li>站點 FacilityArea（T3／N2W／S2W，不屬於任何場區）：defaultFillColor、labelStyle.color；</li>
 *   <li>格位 FacilityArea（有 parentZoneId）：defaultFillColor、labelStyle.color；</li>
 *   <li>ZoneEntrance：strokeColor、labelStyle.color；ZonePartition：defaultFillColor、strokeColor、labelStyle.color。</li>
 * </ul>
 * 號誌、月台門、停靠點、途經點、交叉軌道的方向斜線（crossDiagStrokeColor*）都不碰：那些是狀態或方向語意。
 * 座標、尺寸、旋轉、路徑、拓撲、ID、名稱不碰；改完會逐一比對，白名單以外有任何差異就中止。
 *
 * 寫入走地圖編輯器同一支 API（PUT /syncdrive-api/map/library/:mapId）：檔案與資料庫草稿一起更新，
 * 圖台收到 map_saved 失效通知後自己重載。
 *
 * 用法（預設只列出會改什麼，不寫入）：
 *   node scripts/maintenance/apply-map-platform-palette.js [--map <mapId>] [--base http://127.0.0.1:3000]
 *   MAP_PALETTE_ACCOUNT=… MAP_PALETTE_PASSWORD=… node scripts/maintenance/apply-map-platform-palette.js --apply
 * 不帶 --map 用目前使用中的地圖。寫入要登入（有 site.map.edit 權限的帳號）與內部發佈權杖
 * （SYNC_INTERNAL_TOKEN，未設定用開發預設值）。
 */

const PALETTE = Object.freeze({
  roadFill: '#354357',
  roadDivider: '#28303E',
  stationFill: '#2B7FFF',
  primaryText: '#F3F4F6',
  secondaryText: '#D1D5DC',
  accentBlue: '#51A2FF',
  zoneSectionBackground: '#28303E',
  zoneBorder: '#293444',
  slotBackground: '#354357',
  entranceStroke: '#4D87DA',
});

/** 認得的舊預設色（小寫比對） */
const OLD = Object.freeze({
  roadFill: ['#191f2f'],
  roadDivider: ['#05070a', '#000000'],
  stationFill: ['#18448b'],
  slotFill: ['#136881', '#216d6d', '#1e3a1d'],
  zoneStroke: ['#22d3ee'],
  zoneFill: ['rgba(34, 211, 238, 0.08)', 'rgba(34,211,238,0.08)'],
});

const norm = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const isOld = (value, list) => list.includes(norm(value));

/** 換掉一個欄位（只有舊預設色才換）；回傳有沒有改 */
function swap(obj, key, list, next, changes, where) {
  if (!obj || !isOld(obj[key], list)) return;
  changes.push(`${where}.${key} ${obj[key]} → ${next}`);
  obj[key] = next;
}

/** 文字色沒設定過才補（設定過就是使用者的） */
function labelColor(params, next, changes, where) {
  const style = params.labelStyle && typeof params.labelStyle === 'object' ? params.labelStyle : {};
  if (style.color != null || style.visible === false) return;
  params.labelStyle = { ...style, color: next };
  changes.push(`${where}.labelStyle.color → ${next}`);
}

function recolorFacility(facility, changes) {
  const p = facility.parameters;
  if (!p || typeof p !== 'object') return;
  const where = `${facility.type}/${facility.name}#${facility.id}(${facility.customName ?? ''})`;
  if (facility.type === 'Track') {
    // 沒設填色的軌道用渲染器預設（#191F2F，就是舊道路色）：補上道路色；填色透明度 0 的（純虛線）不補
    if (p.defaultFillColor == null && p.trackFillOpacity !== 0) {
      p.defaultFillColor = PALETTE.roadFill;
      changes.push(`${where}.defaultFillColor（未設，渲染器預設 #191F2F） → ${PALETTE.roadFill}`);
    }
    swap(p, 'defaultFillColor', OLD.roadFill, PALETTE.roadFill, changes, where);
    swap(p, 'strokeColor', OLD.roadDivider, PALETTE.roadDivider, changes, where);
    if (p.trackGenPartColors && typeof p.trackGenPartColors === 'object') {
      swap(p.trackGenPartColors, 'up', OLD.roadFill, PALETTE.roadFill, changes, `${where}.trackGenPartColors`);
      swap(p.trackGenPartColors, 'down', OLD.roadFill, PALETTE.roadFill, changes, `${where}.trackGenPartColors`);
    }
    labelColor(p, PALETTE.secondaryText, changes, where);
    return;
  }
  if (facility.type !== 'Facility') return;
  if (facility.name === 'FacilityArea') {
    if (p.parentZoneId) {
      swap(p, 'defaultFillColor', OLD.slotFill, PALETTE.slotBackground, changes, where);
      labelColor(p, PALETTE.secondaryText, changes, where);
    } else if (isOld(p.defaultFillColor, OLD.stationFill) || norm(p.defaultFillColor) === norm(PALETTE.stationFill)) {
      swap(p, 'defaultFillColor', OLD.stationFill, PALETTE.stationFill, changes, where);
      labelColor(p, PALETTE.primaryText, changes, where);
    }
    return;
  }
  if (facility.name === 'ZoneEntrance') {
    swap(p, 'strokeColor', OLD.zoneStroke, PALETTE.entranceStroke, changes, where);
    labelColor(p, PALETTE.secondaryText, changes, where);
    return;
  }
  if (facility.name === 'ZonePartition') {
    swap(p, 'defaultFillColor', OLD.zoneFill, PALETTE.zoneSectionBackground, changes, where);
    swap(p, 'strokeColor', OLD.zoneStroke, PALETTE.zoneBorder, changes, where);
    labelColor(p, PALETTE.accentBlue, changes, where);
  }
}

/** 整份地圖改色；回傳新文件與改了哪些（不改輸入） */
function recolorMapDocument(doc) {
  const next = JSON.parse(JSON.stringify(doc));
  const changes = [];
  for (const area of next.areas ?? []) {
    for (const facility of area.facilities ?? []) recolorFacility(facility, changes);
  }
  return { doc: next, changes };
}

/** 允許差異的路徑（facility.parameters 底下的樣式欄位） */
const STYLE_PATH = /^areas\[\d+\]\.facilities\[\d+\]\.parameters\.(defaultFillColor|strokeColor|trackGenPartColors\.(up|down)|labelStyle(\.color)?)$/;

/** 列出兩份文件所有不同的路徑 */
function diffPaths(a, b, path = '', out = []) {
  if (Object.is(a, b)) return out;
  const objA = a && typeof a === 'object';
  const objB = b && typeof b === 'object';
  if (!objA || !objB || Array.isArray(a) !== Array.isArray(b)) {
    out.push(path);
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const sub = Array.isArray(a) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
    diffPaths(a[key], b[key], sub, out);
  }
  return out;
}

/** 白名單以外的差異（應該是空的） */
function forbiddenDiffs(before, after) {
  return diffPaths(before, after).filter((p) => !STYLE_PATH.test(p));
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : fallback;
  };
  const base = opt('--base', 'http://127.0.0.1:3000');
  const apply = args.includes('--apply');
  let mapId = opt('--map', null);

  let cookie = '';
  let csrf = '';
  const request = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
        ...(method === 'PUT' ? { 'X-Sync-Internal-Token': process.env.SYNC_INTERNAL_TOKEN ?? 'sync-dev-internal' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    return res.json();
  };

  const account = process.env.MAP_PALETTE_ACCOUNT;
  const password = process.env.MAP_PALETTE_PASSWORD;
  if (account && password) {
    const login = await request('POST', '/syncdrive-api/auth/login', { account_name: account, password });
    csrf = login.csrf_token;
  } else if (apply) {
    throw new Error('寫入要登入：設定 MAP_PALETTE_ACCOUNT、MAP_PALETTE_PASSWORD');
  }

  const entry = mapId
    ? await request('GET', `/syncdrive-api/map/library/${encodeURIComponent(mapId)}`)
    : await request('GET', '/syncdrive-api/map/library/active');
  mapId = entry.mapId ?? entry.mapDocument?.mapId ?? mapId;
  const { doc, changes } = recolorMapDocument(entry.mapDocument);
  const bad = forbiddenDiffs(entry.mapDocument, doc);
  console.log(`地圖 ${mapId}（${entry.displayName ?? ''}）：${changes.length} 個樣式欄位要換`);
  for (const line of changes) console.log(`  ${line}`);
  if (bad.length) throw new Error(`白名單以外有差異，中止：${bad.slice(0, 10).join('、')}`);
  if (!apply || changes.length === 0) {
    console.log(changes.length ? '（只列出，未寫入；加 --apply 寫入）' : '已經是圖台色票，不用改');
    return;
  }
  await request('PUT', `/syncdrive-api/map/library/${encodeURIComponent(mapId)}`, {
    libraryId: entry.libraryId ?? mapId,
    displayName: entry.displayName,
    version: entry.version,
    updatedAt: new Date().toISOString(),
    mapDocument: doc,
  });
  console.log('已寫入（檔案＋資料庫草稿），圖台會自動重載');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { recolorMapDocument, forbiddenDiffs, PALETTE };
