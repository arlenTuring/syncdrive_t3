import { resolveBrowserApiBaseUrl } from '../../../lib/browserApiBase'
import { getDataSourceById } from '../../dashboard/store/useDataSourceStore'
import type { SystemFoundationSettings } from '../systemFoundationSettings'

function apiBase(): string {
  return resolveBrowserApiBaseUrl(
    getDataSourceById('default-internal')?.backendUrl,
  )
}

export async function fetchSystemFoundationSettings(): Promise<SystemFoundationSettings> {
  const res = await fetch(`${apiBase()}/syncdrive-api/system/foundation/settings`)
  if (!res.ok) throw new Error(`系統基礎設定取得失敗（${res.status}）`)
  return res.json()
}

export async function saveSystemFoundationSettings(
  settings: SystemFoundationSettings,
): Promise<SystemFoundationSettings> {
  const res = await fetch(`${apiBase()}/syncdrive-api/system/foundation/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!res.ok) throw new Error(`系統基礎設定儲存失敗（${res.status}）`)
  return res.json()
}

export type HttpsCertificateStatus = {
  protected: boolean
  certificatePresent: boolean
  privateKeyPresent: boolean
  keyMatchesCertificate: boolean
  boundDomain: string | null
  issuer: string | null
  expiresAt: string | null
  fingerprintSha256: string | null
  updatedAt: string | null
}

export async function fetchHttpsCertificateStatus(): Promise<HttpsCertificateStatus> {
  const res = await fetch(
    `${apiBase()}/syncdrive-api/system/foundation/ssl/certificate`,
  )
  if (!res.ok) throw new Error(`憑證狀態取得失敗（${res.status}）`)
  return res.json()
}

export async function rotateHttpsCertificate(input: {
  certificatePem: string
  privateKeyPem: string
}): Promise<HttpsCertificateStatus> {
  const res = await fetch(
    `${apiBase()}/syncdrive-api/system/foundation/ssl/certificate`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) {
    let detail = `憑證上傳失敗（${res.status}）`
    try {
      const body = (await res.json()) as { message?: string | string[] }
      if (typeof body.message === 'string') detail = body.message
      else if (Array.isArray(body.message)) detail = body.message.join('；')
    } catch {
      // ignore
    }
    throw new Error(detail)
  }
  return res.json()
}
