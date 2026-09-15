import {
  DEFAULT_BODY_ELEMENT_HEIGHT,
  DEFAULT_BODY_ELEMENT_WIDTH,
  DEFAULT_BODY_IMAGE,
  DEFAULT_BODY_TINT,
  DEFAULT_DOOR_COLOR,
  DEFAULT_DOOR_IMAGE,
  DEFAULT_LIGHT_IMAGE,
} from '../constants/palette';
import type {
  VehicleBodyElement,
  VehicleDoorElement,
  VehicleElement,
  VehicleElementType,
  VehicleLightElement,
  VehicleTextElement,
} from '../types';
import { newVehicleId } from './id';

export function createVehicleElement(
  type: VehicleElementType,
  x: number,
  y: number,
): VehicleElement {
  const id = newVehicleId('el');
  const base = { id, type, x, y, rotationDeg: 0 };

  switch (type) {
    case 'body':
      return {
        ...base,
        type: 'body',
        width: DEFAULT_BODY_ELEMENT_WIDTH,
        height: DEFAULT_BODY_ELEMENT_HEIGHT,
        defaultImage: DEFAULT_BODY_IMAGE,
        defaultTintColor: DEFAULT_BODY_TINT,
        imageRules: [],
        mqttDataSourceId: 'default-mqtt',
        mqttTopic: 'v1/vtms/PMS01/health/heartbeat',
      } satisfies VehicleBodyElement;
    case 'text':
      return {
        ...base,
        type: 'text',
        width: 80,
        height: 16,
        valueField: 'vehicle_code',
        fontSize: 11,
        fontWeight: 'bold',
        color: '#ffffff',
        textAlign: 'center',
        mqttDataSourceId: 'default-mqtt',
        mqttTopic: 'v1/vtms/PMS01/health/heartbeat',
      } satisfies VehicleTextElement;
    case 'light':
      return {
        ...base,
        type: 'light',
        width: 22,
        height: 44,
        defaultImage: DEFAULT_LIGHT_IMAGE,
        imageRules: [],
        mqttDataSourceId: 'default-mqtt',
        mqttTopic: 'v1/vtms/PMS01/health/heartbeat',
      } satisfies VehicleLightElement;
    case 'door':
      return {
        ...base,
        type: 'door',
        width: 85,
        height: 12,
        doorImage: DEFAULT_DOOR_IMAGE,
        defaultColor: DEFAULT_DOOR_COLOR,
        openPercentField: 'door_open_percent',
        alarmField: 'door_alarm',
        defaultOpenPercent: 0,
        mqttDataSourceId: 'default-mqtt',
        mqttTopic: 'v1/vtms/PMS01/telemetry/update',
      } satisfies VehicleDoorElement;
    default:
      return createVehicleElement('text', x, y);
  }
}
