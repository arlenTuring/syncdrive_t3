// 資料來源管理 Store（後端為權威；localStorage 僅供舊資料匯入）
// 支援兩種類型：
//   'internal' — 連線到 SyncDrive 後端的 PostgreSQL（透過後端 API 代理）
//   'rest'     — 直接呼叫 REST API（回傳 JSON Array）

import { useState, useCallback, useEffect } from 'react';
import { expandBuiltinSqlMacros } from '../constants/demoSql';
import { inferInvalidateTagsFromSql, tagsOverlap } from '../utils/inferInvalidateTagsFromSql';

export type DataSourceType = 'internal' | 'rest' | 'mqtt';

/** 屬性面板「SQL」分頁可選的資料來源類型 */
export const SQL_BINDING_TYPES: readonly DataSourceType[] = ['internal'];
/** 屬性面板「MQTT」分頁可選的資料來源類型 */
export const MQTT_BINDING_TYPES: readonly DataSourceType[] = ['mqtt'];

export type DataSourceBindingKind = 'sql' | 'mqtt';

const BINDING_TYPES: Record<DataSourceBindingKind, readonly DataSourceType[]> = {
  sql: SQL_BINDING_TYPES,
  mqtt: MQTT_BINDING_TYPES,
};

export function getBindingTypes(kind: DataSourceBindingKind): readonly DataSourceType[] {
  return BINDING_TYPES[kind];
}

export function getDataSourcesForBinding(kind: DataSourceBindingKind): DataSourceConfig[] {
  const allowed = new Set(BINDING_TYPES[kind]);
  return load().filter(d => allowed.has(d.type));
}

export function isDataSourceAllowedForBinding(
  id: string | undefined,
  kind: DataSourceBindingKind,
): boolean {
  if (!id) return true;
  const ds = getDataSourceById(id);
  if (!ds) return false;
  return BINDING_TYPES[kind].includes(ds.type);
}

export function getDataSourceTypeLabel(type: DataSourceType): string {
  switch (type) {
    case 'internal': return 'SQL';
    case 'mqtt': return 'MQTT';
    case 'rest': return 'REST';
    default: return type;
  }
}

export interface DataSourceConfig {
  id: string;
  name: string;
  type: DataSourceType;
  backendUrl: string;   // internal/mqtt 型：後端 base URL (REST API 或 WebSocket)
  // mqtt 型：預設訂閱主題
  mqttTopic?: string;
  description: string;
  createdAt: number;
  updatedAt?: number;
}

const STORAGE_KEY = 'syncdrive_datasources';

/**
 * 預設的內建資料來源。
 *
 * <code>backendUrl</code> 留空＝<strong>同源</strong>：開發時走 Vite 代理，部署後走
 * nginx 代理，兩種情況都不必知道後端在哪一台。寫死 <code>http://127.0.0.1:3000</code>
 * 會在部署到別台機器時指到<strong>看網頁的那台電腦</strong>，畫面呈現為「後端沒開」，
 * 但後端其實好好的（見 lib/browserApiBase.ts）。要連別台後端時再由使用者自己填。
 */
export const DEFAULT_DATASOURCE: DataSourceConfig = {
  id: 'default-internal',
  name: 'SyncDrive 本機資料庫',
  type: 'internal',
  backendUrl: '',
  description: 'SyncDrive-T3 後端 PostgreSQL（TimescaleDB）',
  createdAt: 0,
};

const DEFAULT_MQTT_DATASOURCE: DataSourceConfig = {
  id: 'default-mqtt',
  name: 'VTMS MQTT (Socket.IO)',
  type: 'mqtt',
  // 同上：留空＝同源，Socket.IO 也跟著走 nginx 代理
  backendUrl: '',
  description: 'v1/vtms/{vehicle_code}/telemetry|operation|health',
  mqttTopic: 'v1/vtms/+/telemetry/update',
  createdAt: 0,
};

let _cachedSources: DataSourceConfig[] = [DEFAULT_DATASOURCE, DEFAULT_MQTT_DATASOURCE];
let refreshPromise: Promise<DataSourceConfig[]> | null = null;

function load(): DataSourceConfig[] {
  return _cachedSources;
}

function loadLegacy(): DataSourceConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as DataSourceConfig[];
    return list.map((d) => ({
      ...d,
      backendUrl: d.backendUrl?.replace('//localhost:', '//127.0.0.1:') ?? d.backendUrl,
    }));
  } catch {
    return [];
  }
}

function publish(list: DataSourceConfig[]) {
  _cachedSources = list;
  window.dispatchEvent(new Event('syncdrive-datasources-changed'));
}

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({})) as { message?: string | string[] };
  return Array.isArray(body.message) ? body.message.join('; ') : body.message ?? `HTTP ${res.status}`;
}

export async function refreshDataSources(): Promise<DataSourceConfig[]> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const res = await fetch('/syncdrive-api/datasource/definitions');
    if (!res.ok) throw new Error(await readError(res));
    const list = await res.json() as DataSourceConfig[];
    publish(list);
    return list;
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

// 畫布可能在使用者打開設定視窗前就開始查詢；應用啟動時先取得共用定義。
if (typeof window !== 'undefined') void refreshDataSources().catch(() => undefined);

async function saveDefinition(config: DataSourceConfig): Promise<DataSourceConfig> {
  const res = await fetch(`/syncdrive-api/datasource/definitions/${encodeURIComponent(config.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: config.name,
      type: config.type,
      backendUrl: config.backendUrl,
      mqttTopic: config.mqttTopic,
      description: config.description,
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<DataSourceConfig>;
}

export interface MergeDataSourcesResult {
  /** 樣板定義 ID → 這次實際使用的定義 ID（內容不同而另建專用定義時才會有） */
  remap?: Record<string, string>;
  warnings: string[];
}

/** 匯入樣板時合併資料來源定義 */
export async function mergeTemplateDataSources(
  templateSources: DataSourceConfig[],
  options: { overwriteExisting?: boolean } = {},
): Promise<MergeDataSourcesResult> {
  const warnings: string[] = [];
  const remap: Record<string, string> = {};
  const map = new Map(load().map(d => [d.id, d]));

  for (const ts of templateSources) {
    const existing = map.get(ts.id);
    if (!existing) {
      const saved = await saveDefinition(ts);
      map.set(ts.id, saved);
      warnings.push(`已新增資料來源「${ts.name}」（${ts.id}）`);
      continue;
    }
    const urlDiff = existing.backendUrl !== ts.backendUrl;
    const typeDiff = existing.type !== ts.type;
    if (urlDiff || typeDiff) {
      warnings.push(
        `資料來源「${ts.id}」與樣板不同：本機 ${existing.type} @ ${existing.backendUrl}，樣板 ${ts.type} @ ${ts.backendUrl}`,
      );
      if (options.overwriteExisting) {
        // 不覆寫共用定義（會悄悄改到其他儀表板）：另建一份給這張匯入的儀表板專用
        let copyId = `${ts.id}-import-${Date.now().toString(36)}`.slice(0, 128);
        while (map.has(copyId)) copyId = `${copyId}x`.slice(-128);
        const saved = await saveDefinition({ ...ts, id: copyId, name: `${ts.name}（匯入）`, createdAt: Date.now() });
        map.set(copyId, saved);
        remap[ts.id] = copyId;
        warnings.push(`  → 另建專用連線「${saved.name}」（${copyId}），只有這張匯入的儀表板使用；共用的「${ts.id}」不變`);
      }
    }
  }

  publish(Array.from(map.values()));
  return { warnings, remap };
}

// ── 純函式 API（供 Widget 資料取得使用）──────────────────────────────

export function getDataSources(): DataSourceConfig[] {
  return load();
}

export function getDataSourceById(id: string): DataSourceConfig | null {
  return load().find(d => d.id === id) ?? null;
}

/** 向後端寫入儀表板全部示範資料（車輛 + 事件 + 班次卡 + 運能 + 整備） */
export async function seedDashboardAll(datasourceId = 'default-internal'): Promise<{ ok: boolean }> {
  const ds = getDataSourceById(datasourceId);
  if (!ds) throw new Error(`Data source '${datasourceId}' not found`);
  const res = await fetch(`${ds.backendUrl}/syncdrive-api/datasource/seed-dashboard`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

/** @deprecated 請改用 seedDashboardAll（含正線／整備班次卡） */
export async function seedDashboardPanels(datasourceId = 'default-internal'): Promise<{ ok: boolean }> {
  return seedDashboardAll(datasourceId);
}

const QUERY_CACHE_TTL_MS = 2_000;
const QUERY_CACHE_MAX_ENTRIES = 128;
const queryCache = new Map<string, { rows: Record<string, unknown>[]; at: number }>();
const inflightQueries = new Map<string, Promise<Record<string, unknown>[]>>();
/**
 * 每支查詢的版本號：失效通知（訂單寫入、清空、重置）一來就加一。
 * 失效前就送出去的查詢晚回來時，版本已經不同，結果不能再寫回快取，也不會被
 * 新的呼叫共用——否則清空前的舊名冊會在清空後被「補」回來。
 */
const queryGeneration = new Map<string, number>();

/** 清除過期與超量 SQL 快取（避免長時間運行後 Map 無限膨脹） */
export function pruneDatasourceQueryCache(now = Date.now()): void {
  for (const [key, entry] of queryCache) {
    if (now - entry.at >= QUERY_CACHE_TTL_MS) {
      queryCache.delete(key);
    }
  }
  if (queryCache.size <= QUERY_CACHE_MAX_ENTRIES) return;
  const sorted = [...queryCache.entries()].sort((a, b) => a[1].at - b[1].at);
  const drop = sorted.length - QUERY_CACHE_MAX_ENTRIES;
  for (let i = 0; i < drop; i += 1) {
    queryCache.delete(sorted[i][0]);
  }
}

if (typeof window !== 'undefined') {
  window.setInterval(() => pruneDatasourceQueryCache(), 60_000);
  window.addEventListener('visibilitychange', () => {
    if (document.hidden) pruneDatasourceQueryCache();
  });
}

/** 後端推送失效時清除快取，確保 event 模式拿到新資料 */
export function clearDatasourceQueryCache(): void {
  queryCache.clear();
}

/** 定時／回到分頁重查時，只略過指定 SQL 的短期快取。 */
export function clearDatasourceQueryCacheForQuery(datasourceId: string, sqlQuery: string): void {
  queryCache.delete(`${datasourceId}::${expandBuiltinSqlMacros(sqlQuery)}`);
}

/** 僅清除與失效標籤重疊的 SQL 快取（避免整池清空造成查詢雪崩） */
export function clearDatasourceQueryCacheForTags(incomingTags: string[]): void {
  const keys = new Set([...queryCache.keys(), ...inflightQueries.keys()]);
  for (const cacheKey of keys) {
    const sep = cacheKey.indexOf('::');
    const hit = incomingTags.length === 0
      || sep < 0
      || tagsOverlap(inferInvalidateTagsFromSql(cacheKey.slice(sep + 2)), incomingTags);
    if (!hit) continue;
    queryCache.delete(cacheKey);
    inflightQueries.delete(cacheKey);
    queryGeneration.set(cacheKey, (queryGeneration.get(cacheKey) ?? 0) + 1);
  }
}

export async function executeDatasourceQuery(
  datasourceId: string,
  sqlQuery: string,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>[]> {
  const ds = getDataSourceById(datasourceId);
  if (!ds) throw new Error(`Data source '${datasourceId}' not found`);

  if (ds.type !== 'internal') {
    throw new Error(`Data source type '${ds.type}' does not support SQL queries`);
  }

  const normalizedSql = expandBuiltinSqlMacros(sqlQuery);
  const cacheKey = `${datasourceId}::${normalizedSql}`;
  const cached = queryCache.get(cacheKey);
  if (cached && Date.now() - cached.at < QUERY_CACHE_TTL_MS) {
    return cached.rows;
  }

  const existing = inflightQueries.get(cacheKey);
  if (existing) return existing;

  const generation = queryGeneration.get(cacheKey) ?? 0;
  const promise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${ds.backendUrl}/syncdrive-api/datasource/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: normalizedSql }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const rawMsg = (err as { message?: string | string[] }).message;
        const msg = Array.isArray(rawMsg) ? rawMsg.join('; ') : rawMsg;
        if (import.meta.env.DEV) {
          console.warn(
            `[datasource/query] HTTP ${res.status}:`,
            msg ?? '(no message)',
            '\nSQL:',
            normalizedSql.slice(0, 200),
          );
        }
        throw new Error(msg ?? `HTTP ${res.status}`);
      }
      const { rows } = await res.json() as { rows: Record<string, unknown>[] };
      if ((queryGeneration.get(cacheKey) ?? 0) === generation) {
        queryCache.set(cacheKey, { rows, at: Date.now() });
        pruneDatasourceQueryCache();
      }
      return rows;
    } finally {
      clearTimeout(timeoutId);
      // 版本變了代表失效時已移除；此時表裡可能是新一輪的查詢，不能誤刪
      if ((queryGeneration.get(cacheKey) ?? 0) === generation) inflightQueries.delete(cacheKey);
    }
  })();

  inflightQueries.set(cacheKey, promise);
  return promise;
}

/** 取得資料來源的資料表清單 */
export async function fetchTables(datasourceId: string): Promise<string[]> {
  const ds = getDataSourceById(datasourceId);
  if (!ds || ds.type !== 'internal') return [];
  const res = await fetch(`${ds.backendUrl}/syncdrive-api/datasource/tables`);
  const { tables } = await res.json();
  return tables as string[];
}

/** 取得資料表的欄位清單 */
export async function fetchTableSchema(
  datasourceId: string,
  tableName: string,
): Promise<{ column_name: string; data_type: string }[]> {
  const ds = getDataSourceById(datasourceId);
  if (!ds || ds.type !== 'internal') return [];
  const res = await fetch(
    `${ds.backendUrl}/syncdrive-api/datasource/schema?table=${encodeURIComponent(tableName)}`
  );
  return res.json();
}

// ── React Hook（供 Settings 頁面使用）────────────────────────────────

export function useDataSourceStore() {
  const [dataSources, setDataSources] = useState<DataSourceConfig[]>(load);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const legacySources = typeof localStorage === 'undefined' ? [] : loadLegacy();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await refreshDataSources();
      setDataSources(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const sync = () => setDataSources(load());
    window.addEventListener('syncdrive-datasources-changed', sync);
    return () => window.removeEventListener('syncdrive-datasources-changed', sync);
  }, [reload]);

  const addDataSource = useCallback(async (config: Omit<DataSourceConfig, 'id' | 'createdAt'> & { id?: string }) => {
    const newDs: DataSourceConfig = {
      ...config,
      // 指定 ID（例如「本儀表板專用連線」）就用它，否則自動產生
      id: config.id ?? `ds-${Date.now()}`,
      createdAt: Date.now(),
    };
    const saved = await saveDefinition(newDs);
    await reload();
    return saved;
  }, [reload]);

  const updateDataSource = useCallback(async (id: string, patch: Partial<DataSourceConfig>) => {
    const current = load().find((d) => d.id === id);
    if (!current) throw new Error(`找不到資料來源「${id}」`);
    await saveDefinition({ ...current, ...patch, id });
    await reload();
  }, [reload]);

  const deleteDataSource = useCallback(async (id: string) => {
    if (id === DEFAULT_DATASOURCE.id || id === DEFAULT_MQTT_DATASOURCE.id) return;
    const res = await fetch(`/syncdrive-api/datasource/definitions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await readError(res));
    await reload();
  }, [reload]);

  const importLegacyDataSources = useCallback(async () => {
    const current = new Map(load().map((item) => [item.id, item]));
    const conflicts: string[] = [];
    for (const legacy of loadLegacy()) {
      const existing = current.get(legacy.id);
      if (existing) {
        if (existing.type !== legacy.type || existing.backendUrl !== legacy.backendUrl || existing.mqttTopic !== legacy.mqttTopic) {
          conflicts.push(`「${legacy.id}」與伺服器設定不同，未覆寫`);
        }
        continue;
      }
      await saveDefinition(legacy);
    }
    if (conflicts.length === 0) localStorage.removeItem(STORAGE_KEY);
    await reload();
    return conflicts;
  }, [reload]);

  return { dataSources, loading, error, legacySources, reload, importLegacyDataSources, addDataSource, updateDataSource, deleteDataSource };
}
