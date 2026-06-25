import { DEFAULT_BODY_IMAGE, DEFAULT_DOOR_COLOR, DEFAULT_DOOR_IMAGE } from '../constants/palette';
import { normalizeLightImageFile } from './migrateLightImage';
import { migrateLightVisibilityFields } from './migrateLightVisibility';
import { readOperationActions } from './resolveBehaviorActions';
import type { VehicleDefinition, VehicleElement } from '../types';

function normalizePreviewData(
  preview: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const merged = {
    vehicle_code: 'PMS-01',
    trip_code: 'D0950',
    badge_label: 'D0950',
    direction_label: '下行',
    overall_health: 'OK',
    door_open_percent: 0,
    door_fl_open_percent: 0,
    door_fr_open_percent: 0,
    door_rl_open_percent: 0,
    door_rr_open_percent: 0,
    head_light_on: false,
    tail_light_on: false,
    operation_actions: ['charging'],
    operation_action: 'charging',
    ...(preview ?? {}),
  };
  const actions = readOperationActions(merged);
  if (actions.length > 0) {
    merged.operation_actions = actions;
    if (!merged.operation_action) merged.operation_action = actions[0];
  }
  return merged;
}

/** 畫布尺寸改為車體大小，並移除行為元件 */
export function normalizeVehicleCanvasToBody(v: VehicleDefinition): VehicleDefinition {
  const body = v.elements.find((el) => el.type === 'body');
  const elements = v.elements.filter((el) => el.type !== 'behavior');
  if (!body) {
    return { ...v, elements };
  }
  const ox = body.x;
  const oy = body.y;
  const normalized = elements.map((el) => ({
    ...el,
    x: Math.round(el.x - ox),
    y: Math.round(el.y - oy),
  }));
  return {
    ...v,
    width: body.width,
    height: body.height,
    elements: normalized,
  };
}

/** 僅做欄位／素材正規化，不重算元件位置與尺寸 */
export function migrateVehicleDefinition(v: VehicleDefinition): VehicleDefinition {
  const elements = v.elements
    .filter((el) => el.type !== 'behavior')
    .map((el) => {
    const base = { ...el, rotationDeg: el.rotationDeg ?? 0 };
    if (el.type === 'body') {
      return { ...base, defaultImage: DEFAULT_BODY_IMAGE } as VehicleElement;
    }
    if (el.type === 'door') {
      return {
        ...base,
        doorImage: el.doorImage ?? DEFAULT_DOOR_IMAGE,
        defaultColor: el.defaultColor ?? DEFAULT_DOOR_COLOR,
      };
    }
    if (
      el.type === 'text' &&
      el.valueField === 'trip_code' &&
      el.mqttTopic?.includes('/operation/update')
    ) {
      return {
        ...base,
        mqttTopic: el.mqttTopic.replace('/operation/update', '/health/heartbeat'),
      };
    }
    if (el.type === 'light') {
      const { lightEnd: _drop, ...lightRest } = el as VehicleElement & { lightEnd?: string };
      return {
        ...lightRest,
        rotationDeg: lightRest.rotationDeg ?? 0,
        defaultImage: normalizeLightImageFile(el.defaultImage),
        imageRules: [],
      };
    }
    return base;
  });

  return normalizeVehicleCanvasToBody({
    ...v,
    previewData: normalizePreviewData(v.previewData),
    elements: migrateLightVisibilityFields(elements),
  });
}
