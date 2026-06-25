import { HEALTH_STATUS_ICON_BG } from '../constants/healthStatusTheme';

export { HEALTH_STATUS_ICON_BG as VEHICLE_ICON_BG_BY_HEALTH };

export function resolveVehicleIconBgColor(
  variables: Record<string, unknown>,
  sqlRow: Record<string, unknown> | null,
  opts: {
    iconBgColor: string;
    vehicleIconBgVarKey?: string;
    vehicleHealthVarKey?: string;
  },
): string {
  const bgKey = opts.vehicleIconBgVarKey ?? 'icon_bg_color';
  const raw = variables[bgKey] ?? sqlRow?.[bgKey];
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    return String(raw);
  }

  if (!opts.vehicleHealthVarKey?.trim()) {
    return opts.iconBgColor;
  }

  const healthKey = opts.vehicleHealthVarKey;
  const health = String(variables[healthKey] ?? sqlRow?.[healthKey] ?? '').toUpperCase();
  if (health && HEALTH_STATUS_ICON_BG[health]) {
    return HEALTH_STATUS_ICON_BG[health];
  }

  return opts.iconBgColor;
}
