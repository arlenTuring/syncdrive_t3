#!/usr/bin/env -S npx tsx
/**
 * 即時圖台：三站到站資訊改成到站動態卡片、地圖底色換成圖台色票（伺服器上的版面）。
 *
 * 載入版面時 migrateStationEtaChildren 本來就會把舊表格轉成卡片，但那只在畫面上，存檔前資料庫
 * 仍是舊表格；換一台電腦、或 GCP 上的版面也要一樣。這支直接改伺服器上的版面：
 * <ul>
 *   <li>eta-n2w／eta-s2w／eta-t3 舊表格＋直排站名 → 一張 station-eta 卡片（同一個轉換函式）；</li>
 *   <li>已經是卡片的（先前版本轉過的）：位置尺寸對齊 STATION_ETA_LAYOUT（直式、正常三筆由上而下排完，
 *       位置是對過這張圖台道路、站點、號誌量出來的空白區）、標題「到發動態」改「進站動態」、圓角改設計值 20；
 *       出發設定不動；</li>
 *   <li>圖台元件底色舊值 #020617 → 圖台色票 mapBackground。</li>
 * </ul>
 * 其他元件、座標、資料綁定一律不動；跑第二次不會再變。存檔帶版本號，期間有人存過就 409 不覆蓋。
 *
 * 用法（預設只列出差異）：
 *   npx tsx scripts/apply-station-eta-cards.mts [--base http://127.0.0.1:3000]
 *   SYNCDRIVE_ACCOUNT=… SYNCDRIVE_PASSWORD=… npx tsx scripts/apply-station-eta-cards.mts --apply
 */
import { migrateStationEtaChildren, STATION_ETA_LAYOUT } from '../src/features/dashboard/utils/migrateDashboardPlane';
import { MAP_PLATFORM_THEME } from '../src/features/dashboard/constants/mapPlatformTheme';
import type { CanvasElementProps, ChildWidget } from '../src/features/dashboard/types';

const OLD_MAP_BACKGROUND = '#020617';

type PlaneRow = {
  planeId: string;
  name: string;
  width: number;
  height: number;
  viewportMode: string;
  elements: CanvasElementProps[];
  dataSettings?: { sourceMap?: Record<string, string> } | null;
  version?: number;
};

function restyleElement(el: CanvasElementProps): { el: CanvasElementProps; notes: string[] } {
  if (el.canvasKind !== 'map-platform') return { el, notes: [] };
  const notes: string[] = [];
  const before = el.children ?? [];
  let children: ChildWidget[] = migrateStationEtaChildren(before);
  if (children !== before) {
    const gone = before.filter((c) => !children.some((n) => n.id === c.id)).map((c) => c.id);
    notes.push(`舊表格轉卡片：${children.filter((c) => c.type === 'station-eta').map((c) => c.id).join('、')}；移除直排站名 ${gone.join('、') || '—'}`);
  }
  children = children.map((child) => {
    const layout = STATION_ETA_LAYOUT[child.id];
    if (child.type !== 'station-eta' || !layout) return child;
    let next = child;
    const box = (w: typeof child) => `x=${w.x} y=${w.y} ${w.width}×${w.height}`;
    if (child.x !== layout.x || child.y !== layout.y || child.width !== layout.width || child.height !== layout.height) {
      notes.push(`${child.id} ${box(child)} → ${box({ ...child, ...layout })}`);
      next = { ...next, ...layout };
    }
    if (child.title.endsWith(' 到發動態')) {
      const title = child.title.replace(/ 到發動態$/, ' 進站動態');
      notes.push(`${child.id} 標題 ${child.title} → ${title}`);
      next = { ...next, title };
    }
    if (child.borderRadius !== 20) {
      notes.push(`${child.id} 圓角 ${child.borderRadius} → 20`);
      next = { ...next, borderRadius: 20 };
    }
    return next;
  });
  let next: CanvasElementProps = children === before ? el : { ...el, children };
  if ((el.backgroundColor ?? '').toLowerCase() === OLD_MAP_BACKGROUND) {
    notes.push(`圖台底色 ${el.backgroundColor} → ${MAP_PLATFORM_THEME.mapBackground}`);
    next = { ...next, backgroundColor: MAP_PLATFORM_THEME.mapBackground };
  }
  return { el: notes.length ? next : el, notes };
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--base');
  const base = at >= 0 ? args[at + 1] : 'http://127.0.0.1:3000';
  const apply = args.includes('--apply');
  let cookie = '';
  let csrf = '';
  const request = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    return res.json();
  };
  const account = process.env.SYNCDRIVE_ACCOUNT;
  const password = process.env.SYNCDRIVE_PASSWORD;
  if (!account || !password) throw new Error('要登入才能讀寫版面：設定 SYNCDRIVE_ACCOUNT、SYNCDRIVE_PASSWORD');
  csrf = (await request('POST', '/syncdrive-api/auth/login', { account_name: account, password })).csrf_token;

  const rows = (await request('GET', '/syncdrive-api/dashboard/planes')) as PlaneRow[];
  let changed = 0;
  for (const row of rows) {
    const notes: string[] = [];
    const elements = row.elements.map((el) => {
      const r = restyleElement(el);
      notes.push(...r.notes.map((n) => `[${el.label ?? el.id}] ${n}`));
      return r.el;
    });
    if (!notes.length) continue;
    changed += 1;
    console.log(`版面「${row.name}」（${row.planeId}，版本 ${row.version ?? '—'}）`);
    for (const n of notes) console.log(`  ${n}`);
    if (!apply) continue;
    await request('PUT', `/syncdrive-api/dashboard/planes/${encodeURIComponent(row.planeId)}`, {
      planeId: row.planeId, name: row.name, width: row.width, height: row.height, viewportMode: row.viewportMode,
      elements, dataSettings: { sourceMap: { ...(row.dataSettings?.sourceMap ?? {}) } },
      ...(typeof row.version === 'number' ? { expectedVersion: row.version } : {}),
    });
    console.log('  已存回伺服器');
  }
  if (!changed) console.log('沒有要改的版面（已經是卡片與圖台色票）');
  else if (!apply) console.log('（只列出，未寫入；加 --apply 寫入）');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
