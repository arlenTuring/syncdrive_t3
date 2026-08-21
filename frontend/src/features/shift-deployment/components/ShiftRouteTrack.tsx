import type { RouteProgressWidget, RouteStation } from '../../dashboard/types';
import { evenStationAnchors } from '../../dashboard/route-progress/resolveStations';
import { RouteTrackView } from '../../dashboard/route-progress/RouteTrackView';
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

function parseStations(row: ShiftRow): RouteStation[] {
  const items = parseShiftRouteStations(row.routeStations);
  const anchors = evenStationAnchors(items.length);
  return items.map((item, index) => ({
    id: item.id,
    name: item.name,
    stationId: item.stationId,
    value: anchors[index] ?? 0,
  }));
}

function progressPercent(row: ShiftRow, stations: RouteStation[]): number {
  if (Number.isFinite(row.routeProgress) && row.routeProgress > 0) {
    return Math.min(100, Math.max(0, row.routeProgress));
  }
  if (stations.length < 2) return 0;
  const idx = Math.min(Math.max(0, row.segmentIndex), stations.length - 2);
  const from = stations[idx]?.value ?? 0;
  const to = stations[idx + 1]?.value ?? 100;
  const remain = Number.isFinite(row.segmentRemainPct) ? row.segmentRemainPct : 100;
  return from + (to - from) * (1 - Math.min(100, Math.max(0, remain)) / 100);
}

export function ShiftRouteTrack({ row }: { row: ShiftRow }) {
  const stations = parseStations(row);
  return (
    <div className="h-10 min-w-[220px]">
      <RouteTrackView
        widget={TRACK_WIDGET}
        stations={stations}
        progressPercent={progressPercent(row, stations)}
        vehicleIconBg="#51A2FF"
        actionIconUrl={null}
      />
    </div>
  );
}
