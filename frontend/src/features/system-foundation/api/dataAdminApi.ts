import { resolveBrowserApiBaseUrl } from '../../../lib/browserApiBase'
import { getDataSourceById } from '../../dashboard/store/useDataSourceStore'
import type { DemoAccount } from '../../schedule-management/utils/demoAccountPreference'

function apiBase(): string {
  return resolveBrowserApiBaseUrl(getDataSourceById('default-internal')?.backendUrl)
}

function adminHeaders(_account: DemoAccount): HeadersInit {
  const apiKey = import.meta.env.VITE_DATA_ADMIN_API_KEY as string | undefined
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'X-Syncdrive-Admin-Key': apiKey } : {}),
  }
}

export type CleanupCategory = { key: string; label: string; impact: string; tables: string[]; vehicleFilter: boolean; trustedTime: string }
export type RetentionPolicy = { category: string; enabled: boolean; retention_value: number; retention_unit: 'hour' | 'day'; interval_minutes: number; next_run_at: string | null; last_success_at: string | null; last_failure_at: string | null; last_error: string | null; source: string; readOnlyReason?: string }
export type RetentionOverview = {
  collectedAt: number
  database: { name: string; totalBytes: number; includes: string }
  backendFilesystem: { available: boolean; scope: string; path?: string; totalBytes?: number; freeBytes?: number; note: string }
  databaseVolume: { available: boolean; scope: string; note: string }
  categories: Array<CleanupCategory & { category: string; estimatedRows: number; totalBytes: number; oldest: number | null; newest: number | null }>
  policies: RetentionPolicy[]
  countSemantics: string
}
export type CleanupPreview = { planId: string; expiresAt: number; criteria: Record<string, unknown>; preview: { categoryLabel: string; impact: string; environment: Record<string, unknown>; range: { from: number | null; to: number }; vehicleCode: string | null; records: number; relatedRecords: number; affectedReplays: number; affectedOrders: number; protected: string[]; estimatedBytes: number | null; warnings: string[] } }
export type CleanupJob = { id: string; category: string; trigger: string; status: string; requested_at: string; started_at: string | null; finished_at: string | null; stop_requested: boolean; deleted_count: string; expected_count: string; result: Record<string, unknown>; error: string | null }

export async function fetchRetentionOverview(account: DemoAccount) { return readResponse<RetentionOverview>(await fetch(`${apiBase()}/syncdrive-api/data-admin/retention/overview`, { headers: adminHeaders(account) })) }
export async function fetchCleanupCategories(account: DemoAccount) { return readResponse<CleanupCategory[]>(await fetch(`${apiBase()}/syncdrive-api/data-admin/retention/categories`, { headers: adminHeaders(account) })) }
export async function fetchCleanupJobs(account: DemoAccount) { return readResponse<CleanupJob[]>(await fetch(`${apiBase()}/syncdrive-api/data-admin/cleanup/jobs`, { headers: adminHeaders(account) })) }
export async function previewCleanup(account: DemoAccount, body: { category: string; from?: number; to: number; vehicleCode?: string }) { return readResponse<CleanupPreview>(await fetch(`${apiBase()}/syncdrive-api/data-admin/cleanup/preview`, { method: 'POST', headers: adminHeaders(account), body: JSON.stringify(body) })) }
export async function executeCleanupPlan(account: DemoAccount, planId: string) { return readResponse<CleanupJob>(await fetch(`${apiBase()}/syncdrive-api/data-admin/cleanup/plans/${planId}/execute`, { method: 'POST', headers: adminHeaders(account) })) }
export async function stopCleanupJob(account: DemoAccount, jobId: string) { return readResponse<CleanupJob>(await fetch(`${apiBase()}/syncdrive-api/data-admin/cleanup/jobs/${jobId}/stop`, { method: 'POST', headers: adminHeaders(account) })) }
export async function previewRetentionPolicy(account: DemoAccount, category: string, body: { enabled: boolean; retentionValue: number; retentionUnit: 'hour' | 'day'; intervalMinutes: number }) { return readResponse<CleanupPreview>(await fetch(`${apiBase()}/syncdrive-api/data-admin/retention/policies/${category}/preview`, { method: 'POST', headers: adminHeaders(account), body: JSON.stringify(body) })) }
export async function saveRetentionPolicy(account: DemoAccount, category: string, body: { enabled: boolean; retentionValue: number; retentionUnit: 'hour' | 'day'; intervalMinutes: number; confirmationPlanId?: string }) { return readResponse<RetentionPolicy>(await fetch(`${apiBase()}/syncdrive-api/data-admin/retention/policies/${category}`, { method: 'PUT', headers: adminHeaders(account), body: JSON.stringify(body) })) }

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join('、') : body.message
    const suffix = [body.reason, body.requestId ? `request ID：${body.requestId}` : ''].filter(Boolean).join('；')
    throw new Error(`${message || `資料管理請求失敗（${response.status}）`}${suffix ? `；${suffix}` : ''}`)
  }
  return body as T
}

export type DataAdminMetadata = {
  environment: {
    type: string
    host?: string
    port?: number
    database?: string
    schema: string
    databaseUser?: string
    isSuperuser: boolean
  }
  tables: Array<{ schema: string; name: string; estimated_rows: string }>
  columns: Array<{
    schema: string
    table: string
    name: string
    type: string
    nullable: boolean
    default_value: string | null
  }>
  constraints: Array<{
    schema: string
    table: string
    name: string
    type: string
    column: string | null
    foreign_schema: string | null
    foreign_table: string | null
    foreign_column: string | null
  }>
}

export type DataAdminResult = {
  requestId?: string
  rows: Array<Record<string, unknown>>
  rowCount: number
  columns: string[]
  truncated?: boolean
  affected?: number
  durationMs?: number
  operation?: string
  startedAt?: number
  finishedAt?: number
  database?: { committed: boolean; rolledBack: boolean }
  warnings?: string[]
}

export type OrderCleanupPreview = {
  statusCounts: Array<{ status: string; count: number }>
  relatedCounts: Record<string, number>
  preserved: string[]
}

export async function fetchOrderCleanupPreview(account: DemoAccount) {
  return readResponse<OrderCleanupPreview>(
    await fetch(`${apiBase()}/syncdrive-api/data-admin/previews/order-cleanup`, {
      headers: adminHeaders(account),
    }),
  )
}

export type LiveResetPreview = {
  vehicleCodes: string[]
  sql: string
  redisKeys: string[]
  mqttTopics: string[]
  actions: string[]
  preserved: string[]
  warnings: string[]
}

export type LiveResetResult = {
  requestId?: string
  status?: 'completed' | 'partial' | 'failed'
  operation?: string
  startedAt?: number
  finishedAt?: number
  vehicleCodes: string[]
  paused?: boolean
  resumed?: boolean
  note?: string
  database?: { committed: boolean; rolledBack: boolean }
  dispatchPaused?: boolean
  liveInputPaused?: boolean
  steps?: Array<{ id: string; status: 'completed' | 'failed' | 'skipped' | 'not_run'; detail: string }>
}

export async function fetchLiveResetPreview(account: DemoAccount) {
  return readResponse<LiveResetPreview>(
    await fetch(`${apiBase()}/syncdrive-api/data-admin/live-reset/preview`, {
      headers: adminHeaders(account),
    }),
  )
}

export async function executeLiveReset(account: DemoAccount, vehicleCodes: string[]) {
  return readResponse<LiveResetResult>(
    await fetch(`${apiBase()}/syncdrive-api/data-admin/live-reset/execute`, {
      method: 'POST', headers: adminHeaders(account), body: JSON.stringify({ vehicleCodes }),
    }),
  )
}

export async function resumeLiveReset(account: DemoAccount, vehicleCodes: string[]) {
  return readResponse<LiveResetResult>(
    await fetch(`${apiBase()}/syncdrive-api/data-admin/live-reset/resume`, {
      method: 'POST', headers: adminHeaders(account), body: JSON.stringify({ vehicleCodes }),
    }),
  )
}

export async function fetchDataAdminMetadata(account: DemoAccount) {
  return readResponse<DataAdminMetadata>(
    await fetch(`${apiBase()}/syncdrive-api/data-admin/metadata`, {
      headers: adminHeaders(account),
    }),
  )
}

export async function fetchDataAdminSample(
  account: DemoAccount,
  schema: string,
  table: string,
) {
  const params = new URLSearchParams({ schema, table, limit: '20' })
  return readResponse<DataAdminResult>(
    await fetch(`${apiBase()}/syncdrive-api/data-admin/sample?${params}`, {
      headers: adminHeaders(account),
    }),
  )
}

export async function executeDataAdminSql(
  account: DemoAccount,
  body: { sql: string; mode: 'read' | 'write'; requestId: string },
) {
  return readResponse<DataAdminResult>(
    await fetch(`${apiBase()}/syncdrive-api/data-admin/execute`, {
      method: 'POST',
      headers: adminHeaders(account),
      body: JSON.stringify(body),
    }),
  )
}

export async function cancelDataAdminSql(account: DemoAccount, requestId: string) {
  return readResponse<{ requestId: string; cancelled: boolean }>(
    await fetch(`${apiBase()}/syncdrive-api/data-admin/executions/${requestId}/cancel`, {
      method: 'POST',
      headers: adminHeaders(account),
    }),
  )
}
