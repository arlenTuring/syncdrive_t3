import { resolveBrowserApiBaseUrl } from '../../../lib/browserApiBase'
import { getDataSourceById } from '../../dashboard/store/useDataSourceStore'
import type { MonitoringThresholdSettings } from '../thresholdSettings'

function apiBase(): string {
  return resolveBrowserApiBaseUrl(
    getDataSourceById('default-internal')?.backendUrl,
  )
}

export type HostMetricsSnapshot = {
  at: string
  cpuUsagePercent: number | null
  cpuTempC: number | null
  memoryUsagePercent: number | null
  diskFreePercent: number | null
  diskReadMBps: number | null
  diskWriteMBps: number | null
  networkLatencyMs: number | null
}

export type ServiceProbe = {
  id: 'database' | 'mqtt' | 'middleware' | 'telemetry'
  label: string
  detail: string
  status: 'ok' | 'error' | 'unknown'
  latencyMs: number | null
  message: string
}

export type SystemHealthSnapshot = {
  host: HostMetricsSnapshot
  services: ServiceProbe[]
  thresholds: {
    memoryUsageWarnPercent: number
    cpuUsageWarnPercent: number
    diskFreeWarnPercent: number
    settings?: MonitoringThresholdSettings
  }
}

export type HistoryPoint = {
  at: string
  cpuUsagePercent: number | null
  cpuTempC: number | null
  memoryUsagePercent: number | null
  diskFreePercent: number | null
}

export type HealthHistoryRange = '1h' | '6h' | '24h'

export async function fetchSystemHealthSnapshot(): Promise<SystemHealthSnapshot> {
  const res = await fetch(`${apiBase()}/syncdrive-api/system/health/snapshot`)
  if (!res.ok) throw new Error(`健康狀態取得失敗（${res.status}）`)
  return res.json()
}

export async function fetchSystemHealthHistory(
  range: HealthHistoryRange,
): Promise<{ range: HealthHistoryRange; points: HistoryPoint[] }> {
  const res = await fetch(
    `${apiBase()}/syncdrive-api/system/health/history?range=${range}`,
  )
  if (!res.ok) throw new Error(`歷史趨勢取得失敗（${res.status}）`)
  return res.json()
}

export async function fetchMonitoringThresholds(): Promise<MonitoringThresholdSettings> {
  const res = await fetch(`${apiBase()}/syncdrive-api/system/health/thresholds`)
  if (!res.ok) throw new Error(`監測閾值取得失敗（${res.status}）`)
  return res.json()
}

export async function saveMonitoringThresholds(
  settings: MonitoringThresholdSettings,
): Promise<MonitoringThresholdSettings> {
  const res = await fetch(`${apiBase()}/syncdrive-api/system/health/thresholds`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!res.ok) throw new Error(`監測閾值儲存失敗（${res.status}）`)
  return res.json()
}
