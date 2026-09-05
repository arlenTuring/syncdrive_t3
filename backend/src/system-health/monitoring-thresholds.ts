export const MONITORING_THRESHOLDS_SETTING_KEY =
  'system.health.monitoring_thresholds';

export type ThresholdMetricKey =
  | 'cpuUsage'
  | 'cpuTemp'
  | 'memoryUsage'
  | 'diskFree';

export type ThresholdCondition = {
  id: string;
  min: number;
  max: number;
  message: string;
};

export type MetricThresholdConfig = {
  notifyeeIds: string[];
  conditions: ThresholdCondition[];
};

export type MonitoringThresholdSettings = Record<
  ThresholdMetricKey,
  MetricThresholdConfig
>;

const METRIC_KEYS: ThresholdMetricKey[] = [
  'cpuUsage',
  'cpuTemp',
  'memoryUsage',
  'diskFree',
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function normalizeCondition(
  raw: unknown,
  fallbackId: string,
): ThresholdCondition | null {
  if (!isRecord(raw)) return null;
  const min = Number(raw.min);
  const max = Number(raw.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : fallbackId,
    min,
    max,
    message: typeof raw.message === 'string' ? raw.message : '',
  };
}

function normalizeMetric(
  raw: unknown,
  fallback: MetricThresholdConfig,
): MetricThresholdConfig {
  if (!isRecord(raw)) return structuredClone(fallback);
  const notifyeeIds = Array.isArray(raw.notifyeeIds)
    ? raw.notifyeeIds.filter((id): id is string => typeof id === 'string')
    : fallback.notifyeeIds;
  const conditionsRaw = Array.isArray(raw.conditions) ? raw.conditions : [];
  const conditions = conditionsRaw
    .map((c, i) => normalizeCondition(c, `${fallback.conditions[0]?.id ?? 'c'}-${i}`))
    .filter((c): c is ThresholdCondition => !!c);
  return {
    notifyeeIds: notifyeeIds.length ? notifyeeIds : [...fallback.notifyeeIds],
    conditions: conditions.length
      ? conditions
      : structuredClone(fallback.conditions),
  };
}

/** 系統預設（固定 id，所有環境一致） */
export function createDefaultMonitoringThresholds(): MonitoringThresholdSettings {
  return {
    cpuUsage: {
      notifyeeIds: ['admin', 'bella'],
      conditions: [
        {
          id: 'cpuUsage-default',
          min: 80,
          max: 100,
          message: 'CPU 使用率偏高',
        },
      ],
    },
    cpuTemp: {
      notifyeeIds: ['admin', 'bella'],
      conditions: [
        {
          id: 'cpuTemp-default',
          min: 70,
          max: 120,
          message: 'CPU 溫度偏高',
        },
      ],
    },
    memoryUsage: {
      notifyeeIds: ['admin', 'bella'],
      conditions: [
        {
          id: 'memoryUsage-default',
          min: 80,
          max: 100,
          message: '記憶體使用率已超過門檻',
        },
      ],
    },
    diskFree: {
      notifyeeIds: ['admin', 'bella'],
      conditions: [
        {
          id: 'diskFree-default',
          min: 0,
          max: 15,
          message: '主磁碟剩餘容量偏低',
        },
      ],
    },
  };
}

export function normalizeMonitoringThresholds(
  raw: unknown,
): MonitoringThresholdSettings {
  const defaults = createDefaultMonitoringThresholds();
  if (!isRecord(raw)) return defaults;
  const out = {} as MonitoringThresholdSettings;
  for (const key of METRIC_KEYS) {
    out[key] = normalizeMetric(raw[key], defaults[key]);
  }
  return out;
}

export function resolveWarnThreshold(
  config: MetricThresholdConfig | undefined,
  fallback: number,
  mode: 'above-min' | 'below-max' = 'above-min',
): number {
  if (!config?.conditions?.length) return fallback;
  if (mode === 'below-max') {
    const maxes = config.conditions
      .map((c) => c.max)
      .filter((n) => Number.isFinite(n));
    if (!maxes.length) return fallback;
    return Math.max(...maxes);
  }
  const mins = config.conditions
    .map((c) => c.min)
    .filter((n) => Number.isFinite(n));
  if (!mins.length) return fallback;
  return Math.min(...mins);
}
