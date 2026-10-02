import { resolveBrowserApiBaseUrl } from '../../../lib/browserApiBase'
import { getDataSourceById } from '../../dashboard/store/useDataSourceStore'
import type { DemoAccount } from '../../schedule-management/utils/demoAccountPreference'

function apiBase(): string {
  return resolveBrowserApiBaseUrl(getDataSourceById('default-internal')?.backendUrl)
}

function adminHeaders(account: DemoAccount): HeadersInit {
  const apiKey = import.meta.env.VITE_DATA_ADMIN_API_KEY as string | undefined
  return {
    'Content-Type': 'application/json',
    'X-Syncdrive-Operator': account.id,
    'X-Syncdrive-Role': account.id,
    ...(apiKey ? { 'X-Syncdrive-Admin-Key': apiKey } : {}),
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join('、') : body.message
    throw new Error(message || `資料管理請求失敗（${response.status}）`)
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
  vehicleCodes: string[]
  paused?: boolean
  resumed?: boolean
  note?: string
  steps?: Array<{ id: string; status: 'completed' | 'failed' | 'skipped'; detail: string }>
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
