export const SYSTEM_FOUNDATION_SETTINGS_KEY = 'system.foundation.settings';

export type LocaleSettings = {
  uiLocale: 'zh-TW' | 'en-US';
  timeZone: string;
};

export type NtpSettings = {
  primaryServer: string;
  backupServer: string;
  syncInterval: '15m' | '1h' | '6h' | '12h' | '24h';
  maxDriftMs: number;
  /** 上次成功同步時間（ISO）；僅後端寫入 */
  lastSyncAt: string | null;
  /** 當前時間偏移 ms；僅後端寫入 */
  currentOffsetMs: number | null;
};

export type BackupSettings = {
  operationLogRetentionDays: number;
  telemetryRetentionDays: number;
  backupFrequency: '15m' | '1h' | '6h' | '12h' | '24h';
  dailyBackupTime: string;
  localBackupPath: string;
  cloudBackupEnabled: boolean;
  cloudBackupPath: string;
};

export type SslSettings = {
  /** TLS 1.1 一律停用；保留欄位僅相容舊資料 */
  allowTls11: boolean;
  allowTls12: boolean;
  allowTls13: boolean;
  cipherSuite: 'high' | 'compatible' | 'legacy';
};

export type SecurityTimeoutAction = 'auto_reject' | 'auto_approve' | 'escalate';

export type SecuritySettings = {
  dualConfirmEnabled: boolean;
  auditorRoleIds: string[];
  approvalValidityMinutes: 5 | 15 | 30 | 60 | 120;
  timeoutAction: SecurityTimeoutAction;
};

export type MqttAuthMode = 'mtls' | 'tls_userpass' | 'plain';

export type MqttQos = 0 | 1 | 2;

export type MqttSettings = {
  brokerHost: string;
  brokerPort: number;
  authMode: MqttAuthMode;
  qos: MqttQos;
  clientIdPrefix: string;
  keepaliveSeconds: number;
  username: string;
  /** 密碼僅存於系統設定；前端以遮罩顯示 */
  password: string;
};

export type GlobalParamSettings = {
  mapActiveSyncEnabled: boolean;
  collisionProtectionSeconds: number;
  defaultVehicleSpeedLimitKmh: number;
  eventRetentionDays: number;
};

export type SystemFoundationSettings = {
  locale: LocaleSettings;
  ntp: NtpSettings;
  backup: BackupSettings;
  ssl: SslSettings;
  security: SecuritySettings;
  mqtt: MqttSettings;
  globalParams: GlobalParamSettings;
};

export type FoundationSectionId =
  | 'locale'
  | 'ntp'
  | 'backup'
  | 'ssl'
  | 'security'
  | 'mqtt'
  | 'globalParams';

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

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
  };
}

function pickString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function pickNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pickBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function normalizeSystemFoundationSettings(
  raw: unknown,
): SystemFoundationSettings {
  const d = createDefaultSystemFoundationSettings();
  if (!isRecord(raw)) return d;

  const locale = isRecord(raw.locale) ? raw.locale : {};
  const ntp = isRecord(raw.ntp) ? raw.ntp : {};
  const backup = isRecord(raw.backup) ? raw.backup : {};
  const ssl = isRecord(raw.ssl) ? raw.ssl : {};
  const security = isRecord(raw.security) ? raw.security : {};
  const mqtt = isRecord(raw.mqtt) ? raw.mqtt : {};
  const globalParams = isRecord(raw.globalParams) ? raw.globalParams : {};

  const uiLocaleRaw = pickString(locale.uiLocale, d.locale.uiLocale);
  const uiLocale =
    uiLocaleRaw === 'en-US' || uiLocaleRaw === 'zh-TW'
      ? uiLocaleRaw
      : d.locale.uiLocale;

  const syncIntervalRaw = pickString(ntp.syncInterval, d.ntp.syncInterval);
  const syncInterval = (
    ['15m', '1h', '6h', '12h', '24h'] as const
  ).includes(syncIntervalRaw as NtpSettings['syncInterval'])
    ? (syncIntervalRaw as NtpSettings['syncInterval'])
    : d.ntp.syncInterval;

  const backupFreqRaw = pickString(
    backup.backupFrequency,
    d.backup.backupFrequency,
  );
  const backupFrequency = (
    ['15m', '1h', '6h', '12h', '24h'] as const
  ).includes(backupFreqRaw as BackupSettings['backupFrequency'])
    ? (backupFreqRaw as BackupSettings['backupFrequency'])
    : d.backup.backupFrequency;

  return {
    locale: {
      uiLocale,
      timeZone: pickString(locale.timeZone, d.locale.timeZone),
    },
    ntp: {
      primaryServer: pickString(ntp.primaryServer, d.ntp.primaryServer),
      backupServer: pickString(ntp.backupServer, d.ntp.backupServer),
      syncInterval,
      maxDriftMs: pickNumber(ntp.maxDriftMs, d.ntp.maxDriftMs),
      lastSyncAt:
        typeof ntp.lastSyncAt === 'string' || ntp.lastSyncAt === null
          ? (ntp.lastSyncAt as string | null)
          : d.ntp.lastSyncAt,
      currentOffsetMs:
        ntp.currentOffsetMs === null
          ? null
          : pickNumber(ntp.currentOffsetMs, d.ntp.currentOffsetMs ?? 0),
    },
    backup: {
      operationLogRetentionDays: pickNumber(
        backup.operationLogRetentionDays,
        d.backup.operationLogRetentionDays,
      ),
      telemetryRetentionDays: pickNumber(
        backup.telemetryRetentionDays,
        d.backup.telemetryRetentionDays,
      ),
      backupFrequency,
      dailyBackupTime: pickString(
        backup.dailyBackupTime,
        d.backup.dailyBackupTime,
      ),
      localBackupPath: pickString(
        backup.localBackupPath,
        d.backup.localBackupPath,
      ),
      cloudBackupEnabled: pickBool(
        backup.cloudBackupEnabled,
        d.backup.cloudBackupEnabled,
      ),
      cloudBackupPath: pickString(
        backup.cloudBackupPath,
        d.backup.cloudBackupPath,
      ),
    },
    ssl: {
      allowTls11: false,
      allowTls12: pickBool(ssl.allowTls12, d.ssl.allowTls12),
      allowTls13: pickBool(ssl.allowTls13, d.ssl.allowTls13),
      cipherSuite: (['high', 'compatible', 'legacy'] as const).includes(
        ssl.cipherSuite as SslSettings['cipherSuite'],
      )
        ? (ssl.cipherSuite as SslSettings['cipherSuite'])
        : d.ssl.cipherSuite,
    },
    security: {
      dualConfirmEnabled: pickBool(
        security.dualConfirmEnabled ??
          security.requireDualConfirmForCritical,
        d.security.dualConfirmEnabled,
      ),
      auditorRoleIds: Array.isArray(security.auditorRoleIds)
        ? security.auditorRoleIds.filter(
            (id): id is string => typeof id === 'string',
          )
        : d.security.auditorRoleIds,
      approvalValidityMinutes: (
        [5, 15, 30, 60, 120] as const
      ).includes(
        Number(security.approvalValidityMinutes) as SecuritySettings['approvalValidityMinutes'],
      )
        ? (Number(
            security.approvalValidityMinutes,
          ) as SecuritySettings['approvalValidityMinutes'])
        : d.security.approvalValidityMinutes,
      timeoutAction: (
        ['auto_reject', 'auto_approve', 'escalate'] as const
      ).includes(security.timeoutAction as SecurityTimeoutAction)
        ? (security.timeoutAction as SecurityTimeoutAction)
        : d.security.timeoutAction,
    },
    mqtt: {
      brokerHost: pickString(mqtt.brokerHost, d.mqtt.brokerHost),
      brokerPort: pickNumber(mqtt.brokerPort, d.mqtt.brokerPort),
      authMode: (['mtls', 'tls_userpass', 'plain'] as const).includes(
        mqtt.authMode as MqttAuthMode,
      )
        ? (mqtt.authMode as MqttAuthMode)
        : mqtt.useTls
          ? 'tls_userpass'
          : d.mqtt.authMode,
      qos: ([0, 1, 2] as const).includes(Number(mqtt.qos) as MqttQos)
        ? (Number(mqtt.qos) as MqttQos)
        : d.mqtt.qos,
      clientIdPrefix: pickString(mqtt.clientIdPrefix, d.mqtt.clientIdPrefix),
      keepaliveSeconds: pickNumber(
        mqtt.keepaliveSeconds,
        d.mqtt.keepaliveSeconds,
      ),
      username: pickString(mqtt.username, d.mqtt.username),
      password: pickString(mqtt.password, d.mqtt.password),
    },
    globalParams: {
      mapActiveSyncEnabled: pickBool(
        globalParams.mapActiveSyncEnabled,
        d.globalParams.mapActiveSyncEnabled,
      ),
      collisionProtectionSeconds: pickNumber(
        globalParams.collisionProtectionSeconds,
        d.globalParams.collisionProtectionSeconds,
      ),
      defaultVehicleSpeedLimitKmh: pickNumber(
        globalParams.defaultVehicleSpeedLimitKmh,
        d.globalParams.defaultVehicleSpeedLimitKmh,
      ),
      eventRetentionDays: pickNumber(
        globalParams.eventRetentionDays,
        d.globalParams.eventRetentionDays,
      ),
    },
  };
}
