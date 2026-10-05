import type { DashboardPlane, PlaneDataSettings } from '../types';
import { collectFromPlane } from '../template/exportTemplate';
import { resolvePlaneSourceId } from '../context/PlaneDataSourceContext';
import { VTMS_FLEET_HUB_SOURCE_ID } from '../hooks/useVehicleFleetMqttHub';

/** REST（站內 /syncdrive-api）跟著這個來源 ID 的對應走 */
export const PLANE_REST_SOURCE_ID = 'default-internal';

/**
 * 這張儀表板引用到的資料來源 ID（元件綁定＋車隊／圖台 MQTT hub＋站內 REST）。
 * 「資料設定」視窗逐一列出，讓使用者為這張選實際連線。
 */
export function collectPlaneSourceRefs(plane: DashboardPlane): { sql: string[]; mqtt: string[] } {
  const { dataSourceIds, mqttIds } = collectFromPlane(plane);
  const sql = new Set<string>([PLANE_REST_SOURCE_ID, ...dataSourceIds]);
  const mqtt = new Set<string>([VTMS_FLEET_HUB_SOURCE_ID, ...mqttIds]);
  return { sql: [...sql], mqtt: [...mqtt] };
}

/** 哪些儀表板實際用到這份連線定義（直接綁定或經資料設定對應過去） */
export function planesUsingDefinition(planes: DashboardPlane[], definitionId: string): DashboardPlane[] {
  return planes.filter((plane) => {
    const refs = collectPlaneSourceRefs(plane);
    return [...refs.sql, ...refs.mqtt].some((id) => resolvePlaneSourceId(plane.dataSettings, id) === definitionId);
  });
}

/** 改一個對應；選回原本的 ID 等於拿掉對應 */
export function withSourceSelection(
  settings: PlaneDataSettings | undefined,
  boundId: string,
  selectedId: string,
): PlaneDataSettings {
  const sourceMap = { ...(settings?.sourceMap ?? {}) };
  if (!selectedId || selectedId === boundId) delete sourceMap[boundId];
  else sourceMap[boundId] = selectedId;
  return { sourceMap };
}
