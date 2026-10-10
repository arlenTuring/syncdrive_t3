import { useCallback, useState } from 'react';
import VehicleEditor from '../index';
import { fetchVehicleDefinitionReferences, type VehicleModelReference } from '../api/vehicleDefinitionsApi';
import { fetchMapVehicleSettings, type MapVehicleSetting } from '../model/mapVehicleSettingsApi';
import type { VehicleDefinition } from '../types';
import { MapVehicleSettingsPanel } from './MapVehicleSettingsPanel';
import { LegacyVehicleModelPanel } from './LegacyVehicleModelPanel';

type Tab = 'models' | 'maps' | 'legacy';

/**
 * 圖資管理 → 車輛模型。
 *
 * - 模型：既有的車輛模型編輯器（清單、新增、編輯、複製、刪除、匯入匯出），模型存在後端。
 * - 地圖使用設定：哪張地圖用哪個模型、顯示尺寸、行為圖示，以及系統預設模型。
 * - 舊資料：此瀏覽器快取裡的舊模型匯入、儀表板設定遷移成地圖設定（可回復）。
 *
 * 這裡做的是外觀模型，不碰車輛真實 ID、通訊設定或設備主檔。
 */
export function VehicleModelManagement({
  focus,
}: {
  /** 從儀表板「前往圖資管理編輯」帶過來的目標 */
  focus?: { definitionKey?: string | null; mapId?: string | null; nonce: number } | null;
}) {
  const [tab, setTab] = useState<Tab>(focus?.mapId ? 'maps' : 'models');
  const [settings, setSettings] = useState<{
    defaultSetting: MapVehicleSetting | null;
    maps: Record<string, MapVehicleSetting>;
  } | null>(null);
  const [references, setReferences] = useState<Record<string, VehicleModelReference[]>>({});

  const reloadUsage = useCallback((models?: VehicleDefinition[]) => {
    void fetchMapVehicleSettings()
      .then((value) => setSettings({ defaultSetting: value.defaultSetting, maps: value.maps }))
      .catch(() => undefined);
    if (models) {
      void Promise.all(
        models.map(async (model) => [model.id, await fetchVehicleDefinitionReferences(model.id).catch(() => [])] as const),
      ).then((pairs) => setReferences(Object.fromEntries(pairs)));
    }
  }, []);

  const renderUsage = useCallback(
    (vehicle: VehicleDefinition) => {
      const refs = references[vehicle.id] ?? [];
      const isDefault = settings?.defaultSetting?.definitionKey === vehicle.id;
      const maps = refs.filter((ref) => ref.kind === 'map').length;
      const dashboards = refs.filter((ref) => ref.kind === 'dashboard').length;
      if (!isDefault && refs.length === 0)
        return <span className="text-[10px] text-zinc-600">未被使用</span>;
      return (
        <span className="flex flex-wrap gap-1.5 text-[10px]">
          {isDefault ? <span className="rounded bg-sky-600/30 px-1.5 py-px text-sky-200">系統預設</span> : null}
          {maps ? <span className="rounded bg-emerald-600/25 px-1.5 py-px text-emerald-200">{maps} 張地圖</span> : null}
          {dashboards ? (
            <span
              className="rounded bg-amber-600/25 px-1.5 py-px text-amber-200"
              title={refs
                .filter((ref): ref is Extract<VehicleModelReference, { kind: 'dashboard' }> => ref.kind === 'dashboard')
                .map((ref) => `${ref.planeName}${ref.label ? `／${ref.label}` : ''}`)
                .join('\n')}
            >
              {dashboards} 個儀表板元件
            </span>
          ) : null}
        </span>
      );
    },
    [references, settings],
  );

  const tabButton = (value: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      onClick={() => setTab(value)}
      className={`rounded-md px-3 py-1.5 text-xs font-medium ${
        tab === value ? 'bg-zinc-800 text-amber-300' : 'text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-800 bg-zinc-950 px-4 py-2" role="tablist">
        {tabButton('models', '模型')}
        {tabButton('maps', '地圖使用設定')}
        {tabButton('legacy', '舊資料匯入與遷移')}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'models' ? (
          <VehicleEditor
            key={focus?.nonce ?? 0}
            initialVehicleId={focus?.definitionKey ?? null}
            renderUsage={renderUsage}
            onModelsChanged={reloadUsage}
          />
        ) : tab === 'maps' ? (
          <MapVehicleSettingsPanel initialMapId={focus?.mapId ?? null} onChanged={() => reloadUsage()} />
        ) : (
          <LegacyVehicleModelPanel />
        )}
      </div>
    </div>
  );
}
