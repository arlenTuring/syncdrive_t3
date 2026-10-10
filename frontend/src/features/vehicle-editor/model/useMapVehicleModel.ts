import { useEffect, useState } from 'react';
import { subscribeDatasourceInvalidation } from '../../dashboard/utils/datasourceInvalidationBus';
import type { MapVehicleTemplateConfig } from '../../dashboard/utils/resolveMapVehicleTemplate';
import { resolveMapVehicle, type MapVehicleResolution } from './mapVehicleSettingsApi';

/** 後端模型或地圖設定變了會發這個失效標籤（backend VEHICLE_MODEL_TAG） */
export const VEHICLE_MODEL_TAG = 'domain:vehicle_models';

export type MapVehicleModelState = {
  status: 'loading' | 'ready' | 'error';
  resolution: MapVehicleResolution | null;
  /** 可以直接交給圖台的樣板；沒有模型（未設定或模型已刪）時是 null */
  template: MapVehicleTemplateConfig | null;
  error: string | null;
};

/** 解析結果 → 圖台樣板。即時監控、降級即時地圖、圖資預覽、歷史回放都經過這一個轉換 */
export function templateFromResolution(
  resolution: Pick<MapVehicleResolution, 'setting' | 'definition'> | null,
): MapVehicleTemplateConfig | null {
  const definition = resolution?.definition ?? null;
  const setting = resolution?.setting ?? null;
  if (!definition || !setting) return null;
  return {
    definition,
    displayWidthPx: setting.displayWidthPx,
    displayHeightPx: setting.displayHeightPx,
    actionIconRules: setting.actionIconRules,
    behaviorOffsetX: setting.behaviorOffsetX,
    behaviorOffsetY: setting.behaviorOffsetY,
    behaviorIconSize: setting.behaviorIconSize,
  };
}

type Entry = {
  state: MapVehicleModelState;
  listeners: Set<(state: MapVehicleModelState) => void>;
  controller: AbortController | null;
};
const entries = new Map<string, Entry>();
let unsubscribeBus: (() => void) | null = null;

function publish(entry: Entry, state: MapVehicleModelState) {
  entry.state = state;
  entry.listeners.forEach((listener) => listener(state));
}

function load(mapId: string, entry: Entry) {
  entry.controller?.abort();
  const controller = new AbortController();
  entry.controller = controller;
  void resolveMapVehicle(mapId, controller.signal)
    .then((resolution) => {
      if (controller.signal.aborted) return;
      publish(entry, {
        status: 'ready',
        resolution,
        template: templateFromResolution(resolution),
        error: null,
      });
    })
    .catch((reason: Error) => {
      if (controller.signal.aborted) return;
      // 讀不到時保留上一份（畫面不跳回空白），標出錯誤
      publish(entry, { ...entry.state, status: 'error', error: reason.message });
    });
}

function ensureBus() {
  if (unsubscribeBus) return;
  unsubscribeBus = subscribeDatasourceInvalidation((payload) => {
    if (!payload.tags.includes(VEHICLE_MODEL_TAG)) return;
    for (const [mapId, entry] of entries) if (entry.listeners.size > 0) load(mapId, entry);
  });
}

/**
 * 這張地圖要畫哪個車輛模型、多大——共用解析入口。
 *
 * 後端是資料來源（不讀 localStorage）；模型或地圖設定一變，後端發 domain:vehicle_models，
 * 這裡重抓，已開著的圖台直接換成新模型，不必重建元件。同一張地圖多個元件共用一次請求。
 */
export function useMapVehicleModel(mapId: string | null | undefined): MapVehicleModelState {
  const key = mapId ?? '';
  const [state, setState] = useState<MapVehicleModelState>(
    () => entries.get(key)?.state ?? { status: 'loading', resolution: null, template: null, error: null },
  );
  useEffect(() => {
    if (!key) return undefined;
    ensureBus();
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        state: { status: 'loading', resolution: null, template: null, error: null },
        listeners: new Set(),
        controller: null,
      };
      entries.set(key, entry);
    }
    const current = entry;
    current.listeners.add(setState);
    if (current.listeners.size === 1) load(key, current);
    // 共用快取裡已有的那一份（別的元件先讀到的）：跟外部快取同步
    // eslint-disable-next-line react-hooks/set-state-in-effect
    else setState(current.state);
    return () => {
      current.listeners.delete(setState);
    };
  }, [key]);
  return key ? state : { status: 'ready', resolution: null, template: null, error: null };
}

/** 測試用：清掉共用快取 */
export function resetMapVehicleModelCache() {
  for (const entry of entries.values()) entry.controller?.abort();
  entries.clear();
}
