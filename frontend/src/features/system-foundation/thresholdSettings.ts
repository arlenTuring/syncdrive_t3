export type ThresholdMetricKey =
  | 'cpuUsage'
  | 'cpuTemp'
  | 'memoryUsage'
  | 'diskFree'

export type ThresholdCondition = {
  id: string
  /** 區間下限（含） */
  min: number
  /** 區間上限（含） */
  max: number
  message: string
}

export type MetricThresholdConfig = {
  notifyeeIds: string[]
  conditions: ThresholdCondition[]
}

export type MonitoringThresholdSettings = Record<
  ThresholdMetricKey,
  MetricThresholdConfig
>

export type NotifyeeOption = {
  id: string
  name: string
}

/** 權限模組尚未上線前的通知人員選項（對齊設計稿 Admin / Bella） */
export const DEFAULT_NOTIFYEE_OPTIONS: NotifyeeOption[] = [
  { id: 'admin', name: 'Admin' },
  { id: 'bella', name: 'Bella' },
  { id: 'luna', name: 'Luna' },
  { id: 'operator', name: 'Operator' },
]

export const THRESHOLD_METRIC_TABS: Array<{
  id: ThresholdMetricKey
  label: string
  unit: '%' | '°C'
  min: number
  max: number
  step: number
}> = [
  { id: 'cpuUsage', label: 'CPU 使用率', unit: '%', min: 0, max: 100, step: 1 },
  { id: 'cpuTemp', label: 'CPU 溫度', unit: '°C', min: 0, max: 120, step: 1 },
  {
    id: 'memoryUsage',
    label: '記憶體使用率',
    unit: '%',
    min: 0,
    max: 100,
    step: 1,
  },
  {
    id: 'diskFree',
    label: '主磁碟剩餘容量',
    unit: '%',
    min: 0,
    max: 100,
    step: 1,
  },
]

export function createDefaultThresholdSettings(): MonitoringThresholdSettings {
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
  }
}

export function cloneThresholdSettings(
  settings: MonitoringThresholdSettings,
): MonitoringThresholdSettings {
  return structuredClone(settings)
}

/** 取該指標「告警區間」的代表門檻（下限最小值，供趨勢圖標紅） */
export function resolveWarnThreshold(
  config: MetricThresholdConfig | undefined,
  fallback: number,
  mode: 'above-min' | 'below-max' = 'above-min',
): number {
  if (!config?.conditions?.length) return fallback
  if (mode === 'below-max') {
    const maxes = config.conditions
      .map((c) => c.max)
      .filter((n) => Number.isFinite(n))
    if (!maxes.length) return fallback
    return Math.max(...maxes)
  }
  const mins = config.conditions
    .map((c) => c.min)
    .filter((n) => Number.isFinite(n))
  if (!mins.length) return fallback
  return Math.min(...mins)
}

export function newThresholdCondition(): ThresholdCondition {
  return {
    id: crypto.randomUUID(),
    min: 0,
    max: 0,
    message: '',
  }
}
