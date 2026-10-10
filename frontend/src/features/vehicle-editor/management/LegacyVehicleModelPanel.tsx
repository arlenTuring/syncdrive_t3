import { useCallback, useEffect, useMemo, useState } from 'react';
import { VEHICLE_DEFINITIONS_STORAGE_KEY } from '../../../lib/canvasCacheReset';
import {
  fetchVehicleDefinitions,
  saveVehicleDefinition,
  VehicleDefinitionConflictError,
} from '../api/vehicleDefinitionsApi';
import { VehicleDefinitionMapView } from '../elements/VehicleDefinitionMapView';
import {
  fetchVehicleModelMigrations,
  rollbackVehicleModelMigration,
  runVehicleModelMigration,
  type VehicleModelMigrationReport,
} from '../model/mapVehicleSettingsApi';
import type { VehicleDefinition } from '../types';
import { migrateVehicleDefinition } from '../utils/migrateVehicleDefinition';
import { cloneVehicleDefinition } from '../utils/vehicleDefinitionIO';
import { readLegacyVehicleCache } from '../storage/vehicleDefinitionStorage';

type CacheEntry = {
  local: VehicleDefinition;
  server: VehicleDefinition | null;
  state: 'only-local' | 'same' | 'different';
};

/** 比對用：只看外觀內容，不看時間與版本 */
function contentKey(v: VehicleDefinition): string {
  return JSON.stringify({
    name: v.name,
    width: v.width,
    height: v.height,
    backgroundColor: v.backgroundColor ?? null,
    elements: v.elements,
    previewData: v.previewData ?? null,
    rearAxleFromTailRatio: v.rearAxleFromTailRatio ?? null,
  });
}

/** 此瀏覽器的舊模型：另存的舊快取（被後端內容覆寫前保全下來的）＋目前快取，同 ID 以另存的為準 */
function readBrowserCache(): VehicleDefinition[] {
  const stash = readLegacyVehicleCache();
  let current: VehicleDefinition[] = [];
  try {
    const raw = window.localStorage.getItem(VEHICLE_DEFINITIONS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as VehicleDefinition[]) : [];
    current = Array.isArray(parsed) ? parsed.map(migrateVehicleDefinition) : [];
  } catch {
    current = [];
  }
  const seen = new Set(stash.map((v) => v.id));
  return [...stash, ...current.filter((v) => !seen.has(v.id))];
}

/**
 * 舊資料匯入與遷移。
 *
 * 1. 此瀏覽器的舊模型：只看得到<strong>這台瀏覽器</strong>的快取，別台瀏覽器裡的模型這裡拿不到，
 *    要到那台瀏覽器開這一頁匯入。逐一比對後端：
 *    - 只在本機：可以匯入（以原 ID 新增）。
 *    - 同 ID 內容相同：不用處理。
 *    - 同 ID 內容不同：不自動蓋。可以「以新 ID 匯入」保留兩份，或明確確認後覆蓋後端。
 *    程式內建的範例模型不是使用者資料，不列在這裡。
 * 2. 儀表板設定遷移：把儀表板圖台上載具容器的模型與尺寸搬成地圖設定。先試跑看報告，
 *    再正式執行；只新增地圖設定、不改儀表板，可重複執行，每次都留紀錄可回復。
 */
export function LegacyVehicleModelPanel() {
  const [server, setServer] = useState<VehicleDefinition[] | null>(null);
  const [cache, setCache] = useState<VehicleDefinition[]>(() => readBrowserCache());
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [report, setReport] = useState<VehicleModelMigrationReport | null>(null);
  const [history, setHistory] = useState<VehicleModelMigrationReport[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setCache(readBrowserCache());
    const [list, migrations] = await Promise.all([fetchVehicleDefinitions(), fetchVehicleModelMigrations()]);
    // 兩邊都經過同一個格式升級再比，避免只因舊格式欄位不同被判成「內容不同」
    setServer(list.map(migrateVehicleDefinition));
    setHistory(migrations);
  }, []);
  useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 後端讀取是非同步，回來之後才寫狀態
    void reload().catch((error: Error) => setMessage({ tone: 'error', text: error.message }));
  }, [reload]);

  const entries = useMemo<CacheEntry[]>(() => {
    if (!server) return [];
    return cache.map((local) => {
      const match = server.find((s) => s.id === local.id) ?? null;
      return {
        local,
        server: match,
        state: !match ? 'only-local' : contentKey(match) === contentKey(local) ? 'same' : 'different',
      };
    });
  }, [cache, server]);

  const act = async (label: string, run: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      await run();
      await reload();
      setMessage({ tone: 'ok', text: label });
    } catch (error) {
      const text =
        error instanceof VehicleDefinitionConflictError
          ? `${error.message}（未覆蓋，請重新比對）`
          : error instanceof Error
            ? error.message
            : '操作失敗';
      setMessage({ tone: 'error', text });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[#0a0f1a] p-6">
      <div className="mx-auto max-w-5xl space-y-8 text-xs text-zinc-300">
        {message ? (
          <p role="status" className={message.tone === 'ok' ? 'text-emerald-300' : 'text-red-300'}>
            {message.text}
          </p>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-100">此瀏覽器的舊模型</h2>
          <p className="text-zinc-500">
            只列出這台瀏覽器快取裡的模型；其他電腦或瀏覽器裡的模型這裡看不到，請到那台瀏覽器打開此頁匯入。
          </p>
          {server === null ? (
            <p className="text-zinc-500">讀取後端模型中…</p>
          ) : entries.length === 0 ? (
            <p className="text-zinc-500">此瀏覽器沒有快取的模型。</p>
          ) : (
            <table className="w-full overflow-hidden rounded-xl border border-zinc-800">
              <thead className="bg-zinc-950 text-[10px] text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left">此瀏覽器</th>
                  <th className="px-3 py-2 text-left">後端</th>
                  <th className="px-3 py-2 text-left">狀態</th>
                  <th className="px-3 py-2 text-right">處理</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.local.id} className="border-t border-zinc-800">
                    <td className="px-3 py-2">
                      <Thumb vehicle={entry.local} />
                      <div className="mt-1">{entry.local.name}</div>
                      <div className="font-mono text-[10px] text-zinc-600">{entry.local.id}</div>
                    </td>
                    <td className="px-3 py-2">
                      {entry.server ? (
                        <>
                          <Thumb vehicle={entry.server} />
                          <div className="mt-1">
                            {entry.server.name}（第 {entry.server.serverVersion} 版）
                          </div>
                        </>
                      ) : (
                        <span className="text-zinc-600">沒有</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {entry.state === 'same' ? (
                        <span className="text-emerald-300">相同，不用處理</span>
                      ) : entry.state === 'only-local' ? (
                        <span className="text-amber-300">只在此瀏覽器</span>
                      ) : (
                        <span className="text-red-300">同 ID 但內容不同</span>
                      )}
                    </td>
                    <td className="space-x-2 px-3 py-2 text-right">
                      {entry.state === 'only-local' ? (
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded bg-amber-600 px-2 py-1 text-white disabled:opacity-40"
                          onClick={() =>
                            void act(`已匯入「${entry.local.name}」`, () =>
                              saveVehicleDefinition({ ...entry.local, serverVersion: undefined }, null),
                            )
                          }
                        >
                          匯入
                        </button>
                      ) : null}
                      {entry.state === 'different' ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            className="rounded border border-zinc-600 px-2 py-1 disabled:opacity-40"
                            onClick={() => {
                              const copy = cloneVehicleDefinition(entry.local);
                              void act(`已以新 ID ${copy.id} 匯入（後端原模型不變）`, () =>
                                saveVehicleDefinition(
                                  { ...copy, name: `${entry.local.name}（此瀏覽器版本）`, serverVersion: undefined },
                                  null,
                                ),
                              );
                            }}
                          >
                            以新 ID 匯入
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="rounded border border-red-500/60 px-2 py-1 text-red-200 disabled:opacity-40"
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `用此瀏覽器的版本覆蓋後端的「${entry.server?.name}」（第 ${entry.server?.serverVersion} 版）？所有地圖與儀表板都會改用這個外觀。`,
                                )
                              )
                                return;
                              void act('已覆蓋後端版本', () =>
                                saveVehicleDefinition(entry.local, entry.server?.serverVersion ?? null),
                              );
                            }}
                          >
                            覆蓋後端
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-100">儀表板設定遷移成地圖設定</h2>
          <p className="text-zinc-500">
            把儀表板圖台上「載具容器」的模型、顯示尺寸與行為圖示，搬成圖資管理的地圖設定。只新增地圖設定、不改儀表板；
            地圖已有設定就跳過；同一張地圖在不同儀表板設得不一樣會列成衝突，不替你挑。
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              className="rounded border border-zinc-600 px-3 py-1.5 disabled:opacity-40"
              onClick={() =>
                void act('試跑完成（沒有寫入）', async () => setReport(await runVehicleModelMigration(true)))
              }
            >
              試跑
            </button>
            <button
              type="button"
              disabled={busy || !report?.dryRun}
              title={report?.dryRun ? undefined : '先試跑看報告'}
              className="rounded bg-amber-600 px-3 py-1.5 font-semibold text-white disabled:opacity-40"
              onClick={() => void act('遷移完成', async () => setReport(await runVehicleModelMigration(false)))}
            >
              正式執行
            </button>
          </div>
          {report ? <MigrationReportView report={report} /> : null}
          {history.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-[11px] font-semibold text-zinc-400">遷移紀錄</h3>
              {history.map((item) => (
                <div key={item.migrationId ?? item.at} className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2">
                  <span>
                    {new Date(item.at).toLocaleString('zh-TW')}・新增 {item.created.length} 張地圖設定
                    {item.defaultSet ? `・設定預設模型 ${item.defaultSet}` : ''}
                    {item.rolledBackAt ? `・已於 ${new Date(item.rolledBackAt).toLocaleString('zh-TW')} 回復` : ''}
                  </span>
                  {!item.rolledBackAt && item.migrationId ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded border border-zinc-600 px-2 py-1 disabled:opacity-40"
                      onClick={() => {
                        if (!window.confirm('回復這次遷移？只會刪除遷移後沒有人改過的地圖設定。')) return;
                        void act('已回復', async () => {
                          const result = await rollbackVehicleModelMigration(item.migrationId!);
                          setMessage({
                            tone: 'ok',
                            text: `已回復：刪除 ${result.removed.length} 筆${result.kept.length ? `，保留 ${result.kept.length} 筆（遷移後被改過）` : ''}`,
                          });
                        });
                      }}
                    >
                      回復
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function Thumb({ vehicle }: { vehicle: VehicleDefinition }) {
  return (
    <div className="flex h-9 w-28 items-center justify-center overflow-hidden rounded bg-zinc-950">
      <VehicleDefinitionMapView definition={vehicle} displayWidth={104} displayHeight={32} />
    </div>
  );
}

function MigrationReportView({ report }: { report: VehicleModelMigrationReport }) {
  return (
    <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <p className="font-semibold">{report.dryRun ? '試跑報告（尚未寫入）' : `已執行（紀錄 ${report.migrationId ?? '—'}）`}</p>
      <ul className="list-disc space-y-1 pl-5">
        {report.created.map((item) => (
          <li key={item.mapId}>
            {report.dryRun ? '將新增' : '已新增'} 地圖 {item.mapId}：模型 {item.setting.definitionKey}、
            {item.setting.displayWidthPx}×{item.setting.displayHeightPx}、行為規則 {item.setting.actionIconRules?.length ?? 0} 條
            {item.setting.migratedFrom ? `（來源：儀表板 ${item.setting.migratedFrom.planeId} 元件 ${item.setting.migratedFrom.childId ?? item.setting.migratedFrom.elementId}）` : ''}
            {item.note ? `；${item.note}` : ''}
          </li>
        ))}
        {report.defaultSet ? <li>系統預設模型 → {report.defaultSet}（原本沒有預設）</li> : null}
        {report.skipped.map((item) => (
          <li key={`s-${item.mapId}`} className="text-zinc-400">
            跳過 {item.mapId}：{item.reason}
          </li>
        ))}
        {report.conflicts.map((item) => (
          <li key={`c-${item.mapId}`} className="text-red-300">
            衝突 {item.mapId}：{item.reason}
          </li>
        ))}
        {report.created.length + report.skipped.length + report.conflicts.length === 0 ? (
          <li className="text-zinc-500">沒有需要遷移的儀表板設定</li>
        ) : null}
      </ul>
    </div>
  );
}
