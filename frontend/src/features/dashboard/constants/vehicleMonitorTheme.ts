/** @deprecated 請改用 healthStatusTheme.ts */
export {
  type HealthStatus as VehicleMonitorOverall,
  type HealthStatus as VehicleSubsystemStatus,
  HEALTH_STATUS_BORDER as VEHICLE_MONITOR_BORDER,
  HEALTH_STATUS_ICON_BG as VEHICLE_ICON_BG_BY_HEALTH,
} from './healthStatusTheme';

export const SUBSYSTEM_PILL_RULES = [
  { condition: 'status_eq' as const, threshold: 'OK', textColor: '#00BC7D', bgColor: 'rgba(0, 212, 146, 0.2)', borderColor: 'transparent' },
  { condition: 'status_eq' as const, threshold: 'WARNING', textColor: '#FF8904', bgColor: 'rgba(255, 137, 4, 0.2)', borderColor: 'transparent' },
  { condition: 'status_eq' as const, threshold: 'ERROR', textColor: '#FB2C36', bgColor: 'rgba(251, 44, 54, 0.2)', borderColor: 'transparent' },
  { condition: 'status_eq' as const, threshold: 'OFFLINE', textColor: '#a1a1aa', bgColor: 'rgba(212, 212, 216, 0.1)', borderColor: 'transparent' },
];

export const VEHICLE_BADGE_RULES = [
  { value: 'OFFLINE', label: 'OFFLINE', bgColor: 'transparent', textColor: '#f4f4f5' },
];
