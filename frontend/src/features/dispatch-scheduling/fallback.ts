import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  type DispatchListItem,
  type DispatchPriorityKey,
  type DispatchStationStop,
  type DispatchStatusKey,
} from './types';

const DEMO_STATIONS: DispatchStationStop[] = [
  { id: 'st-s2w', stationId: 'station_6', name: 'S2W', taskLabels: ['廣播'] },
  { id: 'st-t3', stationId: 'station_4', name: 'T3', taskLabels: [] },
  { id: 'st-n2w', stationId: 'station_1', name: 'N2W', taskLabels: [] },
];

function row(
  dispatch_code: string,
  priority: DispatchPriorityKey,
  vehicle_code: string,
  status: DispatchStatusKey,
): DispatchListItem {
  return {
    dispatch_id: `dsp-${dispatch_code.toLowerCase()}`,
    dispatch_code,
    priority,
    priority_label: PRIORITY_LABEL[priority],
    location: 'S2W',
    vehicle_code,
    status,
    status_label: STATUS_LABEL[status],
    created_at: '2027.05.01 06:00',
    exec_time: '11:00',
    trip_minutes: 30,
    stations: DEMO_STATIONS,
  };
}

/** 對齊設計稿示範列；後端清單 API 尚未建立 */
export const FALLBACK_DISPATCH_ITEMS: DispatchListItem[] = [
  row('D0954', 'emergency', 'PMS-01', 'running'),
  row('U1000', 'maintenance', 'PMS-02', 'pending'),
  row('D1006', 'general', 'PMS-03', 'running'),
  row('U1012', 'general', 'PMS-04', 'pending_approval'),
  row('D1018', 'general', 'PMS-05', 'pending_approval'),
  row('U1024', 'general', 'PMS-06', 'pending_approval'),
  row('D1030', 'general', 'PMS-01', 'pending_approval'),
  row('U1036', 'general', 'PMS-02', 'pending_approval'),
  row('D1042', 'general', 'PMS-03', 'completed'),
  row('U1048', 'general', 'PMS-04', 'completed'),
  row('D1054', 'general', 'PMS-05', 'rejected'),
];
