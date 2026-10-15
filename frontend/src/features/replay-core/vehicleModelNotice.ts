import type { ReplayVehicleModelSnapshot } from "./ReplayMapLayer";

/** 回放的車輛外觀不是當時完整快照時，要在畫面上說清楚 */
export function replayVehicleModelNotice(
  vehicleModel: ReplayVehicleModelSnapshot | null,
): string | null {
  if (!vehicleModel) return "這段期間沒有保存當時的車輛模型，暫用目前地圖的模型顯示";
  if (vehicleModel.missingDefinitionKey)
    return `當時設定的模型 ${vehicleModel.missingDefinitionKey} 已不存在，以圖示顯示`;
  if (vehicleModel.source === "none") return "當時這張地圖沒有設定車輛模型，以圖示顯示";
  return null;
}
