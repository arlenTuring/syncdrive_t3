export type LocaleSettings = {
  uiLocale: 'zh-TW' | 'en-US'
  timeZone: string
}

export type NtpSettings = {
  primaryServer: string
  backupServer: string
  syncInterval: '15m' | '1h' | '6h' | '12h' | '24h'
  maxDriftMs: number
  lastSyncAt: string | null
  currentOffsetMs: number | null
}

export type BackupSettings = {
  operationLogRetentionDays: number
  telemetryRetentionDays: number
  backupFrequency: '15m' | '1h' | '6h' | '12h' | '24h'
  dailyBackupTime: string
  localBackupPath: string
  cloudBackupEnabled: boolean
  cloudBackupPath: string
}

export type SslSettings = {
  allowTls11: boolean
  allowTls12: boolean
  allowTls13: boolean
  cipherSuite: 'high' | 'compatible' | 'legacy'
}

export type SecurityTimeoutAction = 'auto_reject' | 'auto_approve' | 'escalate'

export type SecuritySettings = {
  dualConfirmEnabled: boolean
  auditorRoleIds: string[]
  approvalValidityMinutes: 5 | 15 | 30 | 60 | 120
  timeoutAction: SecurityTimeoutAction
}

export type MqttAuthMode = 'mtls' | 'tls_userpass' | 'plain'

export type MqttQos = 0 | 1 | 2

export type MqttSettings = {
  brokerHost: string
  brokerPort: number
  authMode: MqttAuthMode
  qos: MqttQos
  clientIdPrefix: string
  keepaliveSeconds: number
  username: string
  password: string
}

export type AuditorRoleOption = {
  id: string
  name: string
}

export type GlobalParamSettings = {
  mapActiveSyncEnabled: boolean
  collisionProtectionSeconds: number
  defaultVehicleSpeedLimitKmh: number
  eventRetentionDays: number
}

export type SystemFoundationSettings = {
  locale: LocaleSettings
  ntp: NtpSettings
  backup: BackupSettings
  ssl: SslSettings
  security: SecuritySettings
  mqtt: MqttSettings
  globalParams: GlobalParamSettings
}

export type FoundationSectionId =
  | 'locale'
  | 'ntp'
  | 'backup'
  | 'ssl'
  | 'security'
  | 'mqtt'
  | 'globalParams'

export const FOUNDATION_SECTIONS: Array<{
  id: FoundationSectionId
  /** i18n key under systemFoundation.sections.* */
  labelKey: FoundationSectionId
}> = [
  { id: 'locale', labelKey: 'locale' },
  { id: 'ntp', labelKey: 'ntp' },
  { id: 'backup', labelKey: 'backup' },
  { id: 'ssl', labelKey: 'ssl' },
  { id: 'security', labelKey: 'security' },
  { id: 'mqtt', labelKey: 'mqtt' },
  { id: 'globalParams', labelKey: 'globalParams' },
]

export const UI_LOCALE_OPTIONS = [
  { value: 'zh-TW' as const, label: '繁體中文' },
  { value: 'en-US' as const, label: 'English' },
]

export const TIME_ZONE_OPTIONS = [
  { value: 'Asia/Taipei', label: 'UTC+08:00 (台北、北京、新加坡)' },
  { value: 'Asia/Tokyo', label: 'UTC+09:00 (東京、首爾)' },
  { value: 'UTC', label: 'UTC+00:00 (世界協調時間)' },
  { value: 'America/Los_Angeles', label: 'UTC-08:00 (洛杉磯)' },
  { value: 'America/New_York', label: 'UTC-05:00 (紐約)' },
  { value: 'Europe/London', label: 'UTC+00:00 / +01:00 (倫敦)' },
]

export const INTERVAL_OPTIONS = [
  { value: '15m' as const, label: '每 15 分鐘' },
  { value: '1h' as const, label: '每 1 小時' },
  { value: '6h' as const, label: '每 6 小時' },
  { value: '12h' as const, label: '每 12 小時' },
  { value: '24h' as const, label: '每 24 小時' },
]

export const CIPHER_SUITE_OPTIONS = [
  {
    value: 'high' as const,
    label: 'High Security (ECDHE-ECDSA-AES256-GCM-SHA384, CHACHA20)',
  },
  {
    value: 'compatible' as const,
    label: 'Compatible (ECDHE-RSA-AES128-GCM-SHA256)',
  },
  {
    value: 'legacy' as const,
    label: 'Legacy (AES128-SHA)',
  },
]

/** 權限模組尚未上線前的審核角色選項 */
export const AUDITOR_ROLE_OPTIONS: AuditorRoleOption[] = [
  { id: 'admin', name: 'Admin' },
  { id: 'operator', name: 'Operator' },
  { id: 'supervisor', name: 'Supervisor' },
  { id: 'luna', name: 'Luna' },
]

export const APPROVAL_VALIDITY_OPTIONS = [
  { value: '5', label: '5 分鐘' },
  { value: '15', label: '15 分鐘' },
  { value: '30', label: '30 分鐘' },
  { value: '60', label: '60 分鐘' },
  { value: '120', label: '120 分鐘' },
]

export const TIMEOUT_ACTION_OPTIONS = [
  { value: 'auto_reject' as const, label: '自動駁回請求' },
  { value: 'auto_approve' as const, label: '自動核准請求' },
  { value: 'escalate' as const, label: '升級至更高權限審核' },
]

export const MQTT_AUTH_MODE_OPTIONS = [
  {
    value: 'mtls' as const,
    label: 'mTLS 雙向證書簽章認證 (推薦最高安全階級)',
  },
  {
    value: 'tls_userpass' as const,
    label: 'TLS + 帳密認證',
  },
  {
    value: 'plain' as const,
    label: '明文連線（僅內網測試）',
  },
]

export const MQTT_QOS_OPTIONS = [
  { value: '0', label: 'QoS 0 - 最多交付一次' },
  { value: '1', label: 'QoS 1 - 至少交付一次 (At least once - 推薦)' },
  { value: '2', label: 'QoS 2 - 恰好交付一次' },
]

export function createDefaultSystemFoundationSettings(): SystemFoundationSettings {
  return {
    locale: {
      uiLocale: 'zh-TW',
      timeZone: 'Asia/Taipei',
    },
    ntp: {
      primaryServer: 'ntp.stdtime.gov.tw',
      backupServer: 'pool.ntp.org',
      syncInterval: '1h',
      maxDriftMs: 500,
      lastSyncAt: null,
      currentOffsetMs: null,
    },
    backup: {
      operationLogRetentionDays: 90,
      telemetryRetentionDays: 180,
      backupFrequency: '1h',
      dailyBackupTime: '02:00',
      localBackupPath: '/var/backups/avms_db/',
      cloudBackupEnabled: true,
      cloudBackupPath: 's3://avms-fleet-backup-vault/prod/',
    },
    ssl: {
      allowTls11: false,
      allowTls12: true,
      allowTls13: true,
      cipherSuite: 'high',
    },
    security: {
      dualConfirmEnabled: true,
      auditorRoleIds: ['admin'],
      approvalValidityMinutes: 15,
      timeoutAction: 'auto_reject',
    },
    mqtt: {
      brokerHost: 'mqtt.avms-fleet.internal',
      brokerPort: 8883,
      authMode: 'mtls',
      qos: 1,
      clientIdPrefix: 'AVMS_EDGE_HUB_',
      keepaliveSeconds: 60,
      username: 'avms_fleet_service',
      password: '',
    },
    globalParams: {
      mapActiveSyncEnabled: true,
      collisionProtectionSeconds: 30,
      defaultVehicleSpeedLimitKmh: 40,
      eventRetentionDays: 90,
    },
  }
}

export function cloneFoundationSettings(
  settings: SystemFoundationSettings,
): SystemFoundationSettings {
  return structuredClone(settings)
}

export function formatNtpSyncTime(
  iso: string | null,
  timeZone: string,
  notSyncedLabel = '尚未同步',
): string {
  if (!iso) return notSyncedLabel
  try {
    const d = new Date(iso)
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d)
    const offset = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    })
      .formatToParts(d)
      .find((p) => p.type === 'timeZoneName')?.value
    return `${parts.replace('T', ' ')} (${offset ?? timeZone})`
  } catch {
    return iso
  }
}

export function formatSslExpiresAtUtc(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    const h = String(d.getUTCHours()).padStart(2, '0')
    const min = String(d.getUTCMinutes()).padStart(2, '0')
    const s = String(d.getUTCSeconds()).padStart(2, '0')
    return `${y}-${m}-${day} ${h}:${min}:${s} UTC`
  } catch {
    return iso
  }
}

export function daysUntilSslExpiry(iso: string): number | null {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    const ms = d.getTime() - Date.now()
    return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
  } catch {
    return null
  }
}
