import { useCallback, useEffect, useMemo, useState } from 'react';
import { NumberInput } from '../../../components/NumberInput';
import { VehicleFleetMqttProvider } from '../../dashboard/context/VehicleFleetMqttContext';
import { MapPlatformLayer } from '../../dashboard/elements/MapPlatformLayer';
import { MapViewport } from '../../degraded-operation/MapViewport';
import { fetchPublishedMapList, type PublishedMapSummary } from '../../map-editor/api/mapLibraryApi';
import { VehicleDefinitionMapView } from '../elements/VehicleDefinitionMapView';
import {
  deleteMapVehicleSetting,
  fetchMapVehicleSettings,
  putMapVehicleSetting,
  setDefaultVehicleModel,
  type MapVehicleSetting,
} from '../model/mapVehicleSettingsApi';
import { templateFromResolution } from '../model/useMapVehicleModel';
import { useVehicleModelList } from '../model/useVehicleModelList';
import { VehicleBehaviorSettingsFields } from '../model/VehicleBehaviorSettingsFields';
import { fitVehicleMarkerSize } from '../utils/vehicleContentBounds';

const DEFAULT_TARGET = '__default__';
type Draft = Pick<
  MapVehicleSetting,
  'definitionKey' | 'displayWidthPx' | 'displayHeightPx' | 'actionIconRules' | 'behaviorOffsetX' | 'behaviorOffsetY' | 'behaviorIconSize'
>;

/**
 * 地圖使用設定：每張地圖用哪個車輛模型、顯示尺寸（上限框，車身等比塞進去）、行為圖示；
 * 以及系統預設（地圖沒有自己的設定時用）。右邊的地圖預覽跟即時監控是同一個 renderer。
 */
export function MapVehicleSettingsPanel({
  initialMapId,
  onChanged,
}: {
  initialMapId: string | null;
  onChanged: () => void;
}) {
  const { models } = useVehicleModelList();
  const [maps, setMaps] = useState<PublishedMapSummary[]>([]);
  const [settings, setSettings] = useState<{
    defaultSetting: MapVehicleSetting | null;
    maps: Record<string, MapVehicleSetting>;
  } | null>(null);
  const [target, setTarget] = useState<string>(initialMapId ?? DEFAULT_TARGET);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const [list, value] = await Promise.all([
      fetchPublishedMapList().catch(() => ({ maps: [], activeMapId: null })),
      fetchMapVehicleSettings(),
    ]);
    setMaps(list.maps);
    setSettings({ defaultSetting: value.defaultSetting, maps: value.maps });
    return value;
  }, []);

  useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 後端讀取是非同步，回來之後才寫狀態
    void reload().catch((error: Error) => setMessage({ tone: 'error', text: error.message }));
  }, [reload]);

  const saved = target === DEFAULT_TARGET ? settings?.defaultSetting ?? null : settings?.maps[target] ?? null;
  // 換目標或重新讀到已存的值時，表單重設成已存的值（render 中依鍵比對重設，不經 effect）
  const savedKey = `${target}:${saved?.updatedAt ?? 'none'}:${settings ? 1 : 0}`;
  const [draftKey, setDraftKey] = useState<string | null>(null);
  if (draftKey !== savedKey) {
    setDraftKey(savedKey);
    setDraft(
      saved
        ? {
            definitionKey: saved.definitionKey,
            displayWidthPx: saved.displayWidthPx,
            displayHeightPx: saved.displayHeightPx,
            actionIconRules: saved.actionIconRules,
            behaviorOffsetX: saved.behaviorOffsetX,
            behaviorOffsetY: saved.behaviorOffsetY,
            behaviorIconSize: saved.behaviorIconSize,
          }
        : null,
    );
  }

  const model = models?.find((m) => m.id === draft?.definitionKey) ?? null;
  const previewTemplate = useMemo(
    () =>
      draft && model
        ? templateFromResolution({
            definition: model,
            setting: { ...draft, definitionVersion: null, updatedAt: 0, updatedBy: null },
          })
        : null,
    [draft, model],
  );
  const fitted = model && draft ? fitVehicleMarkerSize(model, draft.displayWidthPx, draft.displayHeightPx) : null;

  const save = async () => {
    if (!draft?.definitionKey) return;
    setSaving(true);
    setMessage(null);
    try {
      if (target === DEFAULT_TARGET) await setDefaultVehicleModel(draft);
      else await putMapVehicleSetting(target, draft);
      await reload();
      onChanged();
      setMessage({ tone: 'ok', text: '已儲存；開著的即時地圖會自動換成新設定' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : '儲存失敗' });
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    setMessage(null);
    try {
      if (target === DEFAULT_TARGET) await setDefaultVehicleModel(null);
      else await deleteMapVehicleSetting(target);
      await reload();
      onChanged();
      setMessage({ tone: 'ok', text: target === DEFAULT_TARGET ? '已清除系統預設' : '已移除，這張地圖改用系統預設' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : '移除失敗' });
    } finally {
      setSaving(false);
    }
  };

  const rows = [
    { id: DEFAULT_TARGET, name: '系統預設（地圖沒有自己的設定時）', setting: settings?.defaultSetting ?? null },
    ...maps.map((m) => ({ id: m.mapId, name: m.displayName || m.mapId, setting: settings?.maps[m.mapId] ?? null })),
    // 有設定但已不在地圖庫的地圖也列出來，才看得到、刪得掉
    ...Object.keys(settings?.maps ?? {})
      .filter((id) => !maps.some((m) => m.mapId === id))
      .map((id) => ({ id, name: `${id}（不在地圖庫）`, setting: settings?.maps[id] ?? null })),
  ];
  const modelName = (key?: string | null) => models?.find((m) => m.id === key)?.name ?? key ?? '—';

  return (
    <div className="grid h-full min-h-0 grid-cols-1 bg-[#0a0f1a] lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-y-auto border-r border-zinc-800 p-3">
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => setTarget(row.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${
                  target === row.id ? 'border-amber-500 bg-amber-500/10' : 'border-zinc-800 hover:border-zinc-600'
                }`}
              >
                <span className="block font-semibold text-zinc-200">{row.name}</span>
                <span className="text-[11px] text-zinc-500">
                  {row.setting
                    ? `${modelName(row.setting.definitionKey)}・${row.setting.displayWidthPx}×${row.setting.displayHeightPx}`
                    : row.id === DEFAULT_TARGET
                      ? '未設定'
                      : '未設定（用系統預設）'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs">
            <h3 className="text-sm font-semibold text-zinc-200">
              {target === DEFAULT_TARGET ? '系統預設車輛模型' : `地圖 ${rows.find((r) => r.id === target)?.name ?? target}`}
            </h3>
            <label className="block space-y-1">
              <span className="text-[10px] font-bold text-zinc-500">車輛模型</span>
              <select
                value={draft?.definitionKey ?? ''}
                onChange={(e) => {
                  const picked = models?.find((m) => m.id === e.target.value);
                  if (!picked) return setDraft(null);
                  setDraft((current) => {
                    if (current) return { ...current, definitionKey: picked.id };
                    // 第一次選：沿用系統預設的尺寸；沒有預設就照模型車身比例給一個起始值
                    const base = settings?.defaultSetting;
                    if (base) return { definitionKey: picked.id, displayWidthPx: base.displayWidthPx, displayHeightPx: base.displayHeightPx };
                    const unit = fitVehicleMarkerSize(picked, 1000, 1000);
                    const width = 88;
                    return {
                      definitionKey: picked.id,
                      displayWidthPx: width,
                      displayHeightPx: Math.max(8, Math.round((width * unit.height) / unit.width)),
                    };
                  });
                }}
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-zinc-200"
              >
                <option value="">（未設定）</option>
                {(models ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            {draft ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold text-zinc-500">顯示寬（px，沿軌道）</span>
                    <NumberInput
                      min={8}
                      max={600}
                      value={draft.displayWidthPx}
                      onChange={(n) => setDraft({ ...draft, displayWidthPx: n || draft.displayWidthPx })}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-zinc-200"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold text-zinc-500">顯示高（px）</span>
                    <NumberInput
                      min={8}
                      max={600}
                      value={draft.displayHeightPx}
                      onChange={(n) => setDraft({ ...draft, displayHeightPx: n || draft.displayHeightPx })}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-zinc-200"
                    />
                  </label>
                </div>
                <p className="text-[10px] leading-relaxed text-zinc-500">
                  顯示尺寸是上限框：車身照模型自己的比例等比放進去，不會被拉長或壓扁。
                  {fitted ? `實際畫出 ${fitted.width.toFixed(1)}×${fitted.height.toFixed(1)} px。` : ''}
                </p>
                {model ? (
                  <div className="flex items-center justify-center rounded-lg bg-zinc-950 p-3">
                    <div className="relative outline outline-1 outline-dashed outline-zinc-600" style={{ width: draft.displayWidthPx, height: draft.displayHeightPx }}>
                      <VehicleDefinitionMapView
                        definition={model}
                        displayWidth={draft.displayWidthPx}
                        displayHeight={draft.displayHeightPx}
                       
                      />
                    </div>
                  </div>
                ) : null}
                <VehicleBehaviorSettingsFields
                  value={draft}
                  onChange={(patch) => setDraft({ ...draft, ...patch })}
                />
              </>
            ) : null}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={!draft?.definitionKey || saving}
                onClick={() => void save()}
                className="rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white disabled:opacity-40"
              >
                儲存
              </button>
              {saved ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void clear()}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-zinc-300"
                >
                  {target === DEFAULT_TARGET ? '清除預設' : '移除（改用系統預設）'}
                </button>
              ) : null}
            </div>
            {message ? (
              <p className={message.tone === 'ok' ? 'text-emerald-300' : 'text-red-300'}>{message.text}</p>
            ) : null}
          </div>
          {target !== DEFAULT_TARGET ? (
            <div className="flex h-[560px] flex-col self-start rounded-xl border border-zinc-800 bg-zinc-950 xl:sticky xl:top-0">
              <p className="border-b border-zinc-800 px-3 py-2 text-[11px] text-zinc-400">
                圖資預覽（即時車輛、未儲存的設定也會先套用在這裡）
              </p>
              <div className="min-h-0 flex-1">
                <VehicleFleetMqttProvider>
                  <MapViewport storageKey={`vehicle-model-preview:${target}`} key={target}>
                    <MapPlatformLayer mapId={target} vehicleTemplate={previewTemplate} />
                  </MapViewport>
                </VehicleFleetMqttProvider>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
