export type ShiftRouteStation = {
  id: string;
  name: string;
  stationId?: string;
};

export function parseShiftRouteStations(routeStations: string): ShiftRouteStation[] {
  let items: Array<{ name?: string; station_id?: string }> = [];
  try {
    const parsed = JSON.parse(routeStations || '[]') as unknown;
    if (Array.isArray(parsed)) {
      items = parsed as Array<{ name?: string; station_id?: string }>;
    }
  } catch {
    items = [];
  }
  if (items.length === 0) {
    items = [{ name: 'S2W' }, { name: 'T3' }, { name: 'N2W' }];
  }
  return items.map((item, index) => ({
    id: item.station_id || item.name || `s${index}`,
    name: item.name || item.station_id || `站${index + 1}`,
    stationId: item.station_id,
  }));
}
