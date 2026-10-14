const ZH_LABELS: Record<string, string> = {
  AWAITING_DEPARTURE: '已就位，尚未發車',
  TRANSITING: '行駛中',
  RUNNING: '行駛中',
  DWELLING: '停靠中',
  DOCKING: '精準對位停靠',
  IDLE: '待命',
  FAULTED: '車輛故障',
};

const EN_LABELS: Record<string, string> = {
  AWAITING_DEPARTURE: 'Awaiting departure',
  TRANSITING: 'In transit',
  RUNNING: 'In transit',
  DWELLING: 'Dwelling',
  DOCKING: 'Precision docking',
  IDLE: 'Idle',
  FAULTED: 'Vehicle fault',
};

export function vehiclePhaseLabel(value: unknown, language: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const code = value.trim().toUpperCase();
  return (language.startsWith('en') ? EN_LABELS : ZH_LABELS)[code] ?? value;
}
