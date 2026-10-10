/**
 * 「前往圖資管理編輯車輛模型」：儀表板跟圖資管理在同一個外殼裡，用一個視窗事件切換。
 * 外殼聽到就切到圖資資料管理；圖資管理聽到就打開「車輛模型」並選定那個模型。
 */
export const OPEN_VEHICLE_MODELS_EVENT = 'syncdrive:open-vehicle-models';

export type OpenVehicleModelsDetail = { definitionKey?: string | null; mapId?: string | null };

export function requestOpenVehicleModels(detail: OpenVehicleModelsDetail = {}): void {
  window.dispatchEvent(new CustomEvent<OpenVehicleModelsDetail>(OPEN_VEHICLE_MODELS_EVENT, { detail }));
}
