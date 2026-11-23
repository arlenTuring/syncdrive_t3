import { useMemo } from 'react';
import type { RouteProgressWidget, RouteStation } from '../../dashboard/types';
import { evenStationAnchors } from '../../dashboard/route-progress/resolveStations';
import { RouteTrackView } from '../../dashboard/route-progress/RouteTrackView';
import {
  advanceLegProgress,
  legReportFromPayload,
  recallLegProgress,
  rememberLegProgress,
} from '../../dashboard/route-progress/legProgress';
import { useShiftVehicleOperationMqtt } from '../../dashboard/context/VehicleFleetMqttContext';
import { DEFAULT_VEHICLE_ICON_FILE } from '../../dashboard/vehicle-operation-actions';
import { parseShiftRouteStations } from '../parseShiftRouteStations';
import type { ShiftRow } from '../types';

const TRACK_WIDGET: RouteProgressWidget = {
  id: 'shift-deployment-track',
  type: 'route-progress',
  x: 0,
  y: 0,
  width: 400,
  height: 36,
  stations: [],
  valueField: 'route_progress',
  activeColor: '#51A2FF',
  inactiveColor: '#334155',
  vehicleIcon: DEFAULT_VEHICLE_ICON_FILE,
  iconColor: '#ffffff',
  iconBgColor: '#51A2FF',
  fontSize: 12,
  variant: 'track',
  trackStyle: 'mainline',
};

function parseStations(row: Pick<ShiftRow, 'routeStations'>): RouteStation[] {
  const items = parseShiftRouteStations(row.routeStations);
  const anchors = evenStationAnchors(items.length);
  return items.map((item, index) => ({
    id: item.id,
    name: item.name,
    stationId: item.stationId,
    value: anchors[index] ?? 0,
    hidden: item.passThrough,
  }));
}

/**
 * 路線進度：車端 operation/update（MQTT）每來一則就依「到目標站距離／這一段距離分母」推進，
 * 跟儀表板班次卡同一套規則（legProgress）。只採用同一張單（order_id＝shiftKey）的回報；
 * 這張單還沒有回報時用 SQL 的同一套距離進度墊底，再沒有就停在起點。
 * 狀態依單號記在模組裡，清單重查、表格重排都接得上，不跳回起點。
 */
export function ShiftRouteTrack({ row }: { row: ShiftRow }) {
  const { routeStations } = row;
  const stations = useMemo(() => parseStations({ routeStations }), [routeStations]);
  const payload = useShiftVehicleOperationMqtt(row.vehicleCode);
  const percent = useMemo(() => {
    const next = advanceLegProgress(recallLegProgress(row.shiftKey), {
      orderId: row.shiftKey,
      stations,
      report: legReportFromPayload(payload),
      backendLegDistanceMax: row.legDistanceMax,
      sql: { segmentIndex: row.segmentIndex, remainPct: row.segmentRemainPct },
    });
    return rememberLegProgress(next).percent;
  }, [row.shiftKey, row.legDistanceMax, row.segmentIndex, row.segmentRemainPct, stations, payload]);

  if (stations.length === 0) {
    return <span className="text-body-s text-text-quaternary">—</span>;
  }
  return (
    <div className="h-10 min-w-[220px]">
      <RouteTrackView
        widget={TRACK_WIDGET}
        stations={stations}
        progressPercent={percent}
        vehicleIconBg="#51A2FF"
        actionIconUrl={null}
      />
    </div>
  );
}
