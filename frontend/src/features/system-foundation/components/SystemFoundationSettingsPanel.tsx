import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  writeUserLocaleOverride,
} from '../../../i18n/localePreference'
import {
  fetchHttpsCertificateStatus,
  fetchSystemFoundationSettings,
  rotateHttpsCertificate,
  saveSystemFoundationSettings,
  type HttpsCertificateStatus,
} from '../api/systemFoundationSettingsApi'
import {
  cloneFoundationSettings,
  createDefaultSystemFoundationSettings,
  APPROVAL_VALIDITY_OPTIONS,
  AUDITOR_ROLE_OPTIONS,
  CIPHER_SUITE_OPTIONS,
  daysUntilSslExpiry,
  FOUNDATION_SECTIONS,
  formatNtpSyncTime,
  formatSslExpiresAtUtc,
  INTERVAL_OPTIONS,
  MQTT_AUTH_MODE_OPTIONS,
  MQTT_QOS_OPTIONS,
  TIME_ZONE_OPTIONS,
  TIMEOUT_ACTION_OPTIONS,
  UI_LOCALE_OPTIONS,
  type FoundationSectionId,
  type SystemFoundationSettings,
} from '../systemFoundationSettings'
import {
  CheckboxOption,
  ChipMultiSelectField,
  FieldLabel,
  NumberStepperField,
  SelectField,
  SettingsFooter,
  TextField,
  TimeField,
  ToggleRow,
} from './SettingsFormControls'

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="mb-5 text-[15px] font-semibold text-zinc-50">{children}</h2>
  )
}

export function SystemFoundationSettingsPanel() {
  const { t, i18n } = useTranslation()
  const [section, setSection] = useState<FoundationSectionId>('locale')
  const [saved, setSaved] = useState<SystemFoundationSettings>(() =>
    createDefaultSystemFoundationSettings(),
  )
  const [draft, setDraft] = useState<SystemFoundationSettings>(() =>
    createDefaultSystemFoundationSettings(),
  )
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [certStatus, setCertStatus] = useState<HttpsCertificateStatus | null>(
    null,
  )
  const [certLoadError, setCertLoadError] = useState<string | null>(null)
  const [certPem, setCertPem] = useState('')
  const [keyPem, setKeyPem] = useState('')
  const [rotating, setRotating] = useState(false)
  const [rotateError, setRotateError] = useState<string | null>(null)

  const loadCertificateStatus = useCallback(async () => {
    try {
      const status = await fetchHttpsCertificateStatus()
      setCertStatus(status)
      setCertLoadError(null)
    } catch (err) {
      setCertLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchSystemFoundationSettings()
      setSaved(data)
      setDraft(cloneFoundationSettings(data))
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (section === 'ssl') void loadCertificateStatus()
  }, [section, loadCertificateStatus])

  const onCancel = () => {
    setDraft(cloneFoundationSettings(saved))
    setError(null)
  }

  const onSave = () => {
    setSaving(true)
    setError(null)
    void saveSystemFoundationSettings(draft)
      .then(async (next) => {
        setSaved(next)
        setDraft(cloneFoundationSettings(next))
        // 儲存系統預設語系後同步介面
        writeUserLocaleOverride(next.locale.uiLocale)
        if (i18n.language !== next.locale.uiLocale) {
          await i18n.changeLanguage(next.locale.uiLocale)
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setSaving(false))
  }

  const onRotateCertificate = () => {
    setRotating(true)
    setRotateError(null)
    void rotateHttpsCertificate({
      certificatePem: certPem,
      privateKeyPem: keyPem,
    })
      .then((status) => {
        setCertStatus(status)
        setKeyPem('')
        setCertPem('')
      })
      .catch((err) => {
        setRotateError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setRotating(false))
  }

  const readPemFile = (file: File | undefined, target: 'cert' | 'key') => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      if (target === 'cert') setCertPem(text)
      else setKeyPem(text)
    }
    reader.readAsText(file)
  }

  const sectionLabel = t(
    `systemFoundation.sections.${section}` as const,
  )

  return (
    <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
      <aside className="flex w-[220px] shrink-0 flex-col gap-0.5 overflow-y-auto rounded-2xl border border-zinc-800/80 bg-[#141416] p-2">
        {FOUNDATION_SECTIONS.map((item) => {
          const active = section === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`rounded-lg px-3 py-2.5 text-left text-[13px] transition ${
                active
                  ? 'bg-[#1a3a5c] font-medium text-sky-300'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
              }`}
            >
              {t(`systemFoundation.sections.${item.id}`)}
            </button>
          )
        })}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800/80 bg-[#141416] p-5">
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
            {t('systemFoundation.loadingSettings')}
          </div>
        ) : loadError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <p className="text-sm text-rose-300">{loadError}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg bg-zinc-800 px-4 py-2 text-[13px] text-zinc-200 hover:bg-zinc-700"
            >
              {t('common.retry')}
            </button>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {section === 'locale' ? (
                <>
                  <SectionTitle>{sectionLabel}</SectionTitle>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <SelectField
                      label={t('systemFoundation.locale.uiLocale')}
                      value={draft.locale.uiLocale}
                      options={UI_LOCALE_OPTIONS}
                      onChange={(v) =>
                        setDraft((prev) => ({
                          ...prev,
                          locale: {
                            ...prev.locale,
                            uiLocale: v as typeof prev.locale.uiLocale,
                          },
                        }))
                      }
                    />
                    <SelectField
                      label={t('systemFoundation.locale.timeZone')}
                      value={draft.locale.timeZone}
                      options={TIME_ZONE_OPTIONS}
                      onChange={(v) =>
                        setDraft((prev) => ({
                          ...prev,
                          locale: { ...prev.locale, timeZone: v },
                        }))
                      }
                    />
                  </div>
                </>
              ) : null}

              {section === 'ntp' ? (
                <>
                  <SectionTitle>{sectionLabel}</SectionTitle>
                  <div className="space-y-4">
                    <TextField
                      label={t('systemFoundation.ntp.primary')}
                      value={draft.ntp.primaryServer}
                      onChange={(v) =>
                        setDraft((prev) => ({
                          ...prev,
                          ntp: { ...prev.ntp, primaryServer: v },
                        }))
                      }
                    />
                    <TextField
                      label={t('systemFoundation.ntp.backup')}
                      value={draft.ntp.backupServer}
                      onChange={(v) =>
                        setDraft((prev) => ({
                          ...prev,
                          ntp: { ...prev.ntp, backupServer: v },
                        }))
                      }
                    />
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <SelectField
                        label={t('systemFoundation.ntp.syncInterval')}
                        value={draft.ntp.syncInterval}
                        options={INTERVAL_OPTIONS}
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            ntp: {
                              ...prev.ntp,
                              syncInterval:
                                v as typeof prev.ntp.syncInterval,
                            },
                          }))
                        }
                      />
                      <NumberStepperField
                        label={t('systemFoundation.ntp.maxDrift')}
                        value={draft.ntp.maxDriftMs}
                        unit={t('systemFoundation.units.ms')}
                        min={1}
                        max={60_000}
                        step={10}
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            ntp: { ...prev.ntp, maxDriftMs: v },
                          }))
                        }
                      />
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-[#101012] px-4 py-3 text-[13px]">
                      <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                        <span className="text-zinc-400">
                          {t('systemFoundation.ntp.lastSync')}
                        </span>
                        <span className="tabular-nums text-zinc-200">
                          {formatNtpSyncTime(
                            draft.ntp.lastSyncAt,
                            draft.locale.timeZone,
                            t('systemFoundation.ntp.notSynced'),
                          )}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                        <span className="text-zinc-400">{t('systemFoundation.ntp.currentOffset')}</span>
                        <span
                          className={`tabular-nums ${
                            draft.ntp.currentOffsetMs == null
                              ? 'text-zinc-500'
                              : Math.abs(draft.ntp.currentOffsetMs) <=
                                  draft.ntp.maxDriftMs
                                ? 'text-emerald-400'
                                : 'text-amber-400'
                          }`}
                        >
                          {draft.ntp.currentOffsetMs == null
                            ? '—'
                            : `${draft.ntp.currentOffsetMs >= 0 ? '+' : ''}${draft.ntp.currentOffsetMs.toFixed(3)} ms（${
                                Math.abs(draft.ntp.currentOffsetMs) <=
                                draft.ntp.maxDriftMs
                                  ? t('systemFoundation.ntp.normal')
                                  : t('systemFoundation.ntp.overThreshold')
                              }）`}
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}

              {section === 'backup' ? (
                <>
                  <SectionTitle>{sectionLabel}</SectionTitle>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <NumberStepperField
                        label={t('systemFoundation.backup.opLogDays')}
                        value={draft.backup.operationLogRetentionDays}
                        unit={t('systemFoundation.backup.days')}
                        min={1}
                        max={3650}
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            backup: {
                              ...prev.backup,
                              operationLogRetentionDays: v,
                            },
                          }))
                        }
                      />
                      <NumberStepperField
                        label={t('systemFoundation.backup.telemetryDays')}
                        value={draft.backup.telemetryRetentionDays}
                        unit={t('systemFoundation.backup.days')}
                        min={1}
                        max={3650}
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            backup: {
                              ...prev.backup,
                              telemetryRetentionDays: v,
                            },
                          }))
                        }
                      />
                      <SelectField
                        label={t('systemFoundation.backup.frequency')}
                        value={draft.backup.backupFrequency}
                        options={INTERVAL_OPTIONS}
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            backup: {
                              ...prev.backup,
                              backupFrequency:
                                v as typeof prev.backup.backupFrequency,
                            },
                          }))
                        }
                      />
                      <TimeField
                        label={t('systemFoundation.backup.dailyTime')}
                        value={draft.backup.dailyBackupTime}
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            backup: { ...prev.backup, dailyBackupTime: v },
                          }))
                        }
                      />
                    </div>
                    <TextField
                      label={t('systemFoundation.backup.localPath')}
                      value={draft.backup.localBackupPath}
                      onChange={(v) =>
                        setDraft((prev) => ({
                          ...prev,
                          backup: { ...prev.backup, localBackupPath: v },
                        }))
                      }
                    />
                    <div className="border-t border-zinc-800 pt-4">
                      <ToggleRow
                        label={t('systemFoundation.backup.cloudSync')}
                        checked={draft.backup.cloudBackupEnabled}
                        onChange={(checked) =>
                          setDraft((prev) => ({
                            ...prev,
                            backup: {
                              ...prev.backup,
                              cloudBackupEnabled: checked,
                            },
                          }))
                        }
                      />
                      <div className="mt-3">
                        <TextField
                          label={t('systemFoundation.backup.cloudPath')}
                          value={draft.backup.cloudBackupPath}
                          onChange={(v) =>
                            setDraft((prev) => ({
                              ...prev,
                              backup: { ...prev.backup, cloudBackupPath: v },
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                </>
              ) : null}

              {section === 'ssl' ? (
                <>
                  <div className="mb-5 flex items-start justify-between gap-3">
                    <h2 className="text-[15px] font-semibold text-zinc-50">
                      {sectionLabel}
                    </h2>
                    <span
                      className={`inline-flex items-center gap-1.5 text-[12px] ${
                        certStatus?.protected
                          ? 'text-emerald-400'
                          : 'text-amber-400'
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          certStatus?.protected
                            ? 'bg-emerald-400'
                            : 'bg-amber-400'
                        }`}
                      />
                      {certStatus?.protected
                        ? t('systemFoundation.ssl.protected')
                        : t('systemFoundation.ssl.unprotected')}
                    </span>
                  </div>
                  <div className="space-y-5">
                    {certLoadError ? (
                      <p className="text-[12px] text-rose-300">{certLoadError}</p>
                    ) : null}

                    <div>
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h3 className="text-[13px] font-medium text-zinc-200">
                          {t('systemFoundation.ssl.activeInfo')}
                        </h3>
                        <div className="flex items-center gap-3">
                          {certStatus?.expiresAt
                            ? (() => {
                                const days = daysUntilSslExpiry(
                                  certStatus.expiresAt,
                                )
                                return days == null ? null : (
                                  <span className="text-[12px] text-emerald-400">
                                    {t('systemFoundation.ssl.daysLeft', {
                                      days: days.toLocaleString('en-US'),
                                    })}
                                  </span>
                                )
                              })()
                            : null}
                          <button
                            type="button"
                            onClick={() => void loadCertificateStatus()}
                            className="text-[12px] text-zinc-400 hover:text-zinc-200"
                          >
                            {t('systemFoundation.ssl.reloadStatus')}
                          </button>
                        </div>
                      </div>
                      {!certStatus?.certificatePresent ? (
                        <p className="rounded-xl border border-dashed border-zinc-700 bg-[#101012] px-4 py-6 text-center text-[13px] text-zinc-500">
                          {t('systemFoundation.ssl.noCert')}
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div className="rounded-xl border border-zinc-800 bg-[#101012] px-4 py-3">
                            <p className="text-[11px] text-zinc-500">
                              {t('systemFoundation.ssl.boundDomain')}
                            </p>
                            <p className="mt-1.5 truncate text-[13px] text-sky-400">
                              {certStatus.boundDomain ?? '—'}
                            </p>
                          </div>
                          <div className="rounded-xl border border-zinc-800 bg-[#101012] px-4 py-3">
                            <p className="text-[11px] text-zinc-500">
                              {t('systemFoundation.ssl.issuer')}
                            </p>
                            <p className="mt-1.5 truncate text-[13px] text-zinc-100">
                              {certStatus.issuer ?? '—'}
                            </p>
                          </div>
                          <div className="rounded-xl border border-zinc-800 bg-[#101012] px-4 py-3">
                            <p className="text-[11px] text-zinc-500">
                              {t('systemFoundation.ssl.expiresAt')}
                            </p>
                            <p className="mt-1.5 truncate text-[13px] tabular-nums text-zinc-100">
                              {certStatus.expiresAt
                                ? formatSslExpiresAtUtc(certStatus.expiresAt)
                                : '—'}
                            </p>
                          </div>
                        </div>
                      )}
                      {certStatus?.certificatePresent &&
                      !certStatus.keyMatchesCertificate ? (
                        <p className="mt-2 text-[12px] text-amber-400">
                          {certStatus.privateKeyPresent
                            ? t('systemFoundation.ssl.keyMismatch')
                            : t('systemFoundation.ssl.keyMissing')}
                        </p>
                      ) : null}
                      {certStatus?.fingerprintSha256 ? (
                        <p className="mt-2 break-all text-[11px] text-zinc-500">
                          {t('systemFoundation.ssl.fingerprint')}:{' '}
                          {certStatus.fingerprintSha256}
                        </p>
                      ) : null}
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-[#101012] px-4 py-4">
                      <h3 className="text-[13px] font-medium text-zinc-200">
                        {t('systemFoundation.ssl.rotateTitle')}
                      </h3>
                      <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                        {t('systemFoundation.ssl.rotateHint')}
                      </p>
                      <div className="mt-4 space-y-3">
                        <label className="block">
                          <FieldLabel>
                            {t('systemFoundation.ssl.certPem')}
                          </FieldLabel>
                          <input
                            type="file"
                            accept=".crt,.pem,.cer,.cert,text/plain"
                            className="mb-2 block w-full text-[12px] text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-[12px] file:text-zinc-200"
                            onChange={(e) =>
                              readPemFile(e.target.files?.[0], 'cert')
                            }
                          />
                          <textarea
                            value={certPem}
                            onChange={(e) => setCertPem(e.target.value)}
                            rows={4}
                            placeholder={t(
                              'systemFoundation.ssl.pastePlaceholder',
                            )}
                            className="w-full rounded-lg border border-zinc-700 bg-[#1c1c1f] px-3 py-2 font-mono text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500/70"
                            spellCheck={false}
                            autoComplete="off"
                          />
                        </label>
                        <label className="block">
                          <FieldLabel>
                            {t('systemFoundation.ssl.keyPem')}
                          </FieldLabel>
                          <input
                            type="file"
                            accept=".key,.pem,text/plain"
                            className="mb-2 block w-full text-[12px] text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-[12px] file:text-zinc-200"
                            onChange={(e) =>
                              readPemFile(e.target.files?.[0], 'key')
                            }
                          />
                          <textarea
                            value={keyPem}
                            onChange={(e) => setKeyPem(e.target.value)}
                            rows={3}
                            placeholder={t(
                              'systemFoundation.ssl.pastePlaceholder',
                            )}
                            className="w-full rounded-lg border border-zinc-700 bg-[#1c1c1f] px-3 py-2 font-mono text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500/70"
                            spellCheck={false}
                            autoComplete="off"
                          />
                        </label>
                        {rotateError ? (
                          <p className="text-[12px] text-rose-300">
                            {rotateError}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          disabled={
                            rotating || !certPem.trim() || !keyPem.trim()
                          }
                          onClick={onRotateCertificate}
                          className="rounded-lg bg-[#2B7FFF] px-4 py-2 text-[13px] font-medium text-white transition hover:bg-[#1f6fe0] disabled:opacity-50"
                        >
                          {rotating
                            ? t('systemFoundation.ssl.rotating')
                            : t('systemFoundation.ssl.rotate')}
                        </button>
                      </div>
                    </div>

                    <div>
                      <FieldLabel>
                        {t('systemFoundation.ssl.tlsVersions')}
                      </FieldLabel>
                      <div className="mt-1 flex flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:gap-4">
                        <CheckboxOption
                          label={t('systemFoundation.ssl.tls11')}
                          checked={false}
                          disabled
                          onChange={() => undefined}
                        />
                        <CheckboxOption
                          label={t('systemFoundation.ssl.tls12')}
                          checked={draft.ssl.allowTls12}
                          onChange={(checked) =>
                            setDraft((prev) => ({
                              ...prev,
                              ssl: {
                                ...prev.ssl,
                                allowTls11: false,
                                allowTls12: checked,
                              },
                            }))
                          }
                        />
                        <CheckboxOption
                          label={t('systemFoundation.ssl.tls13')}
                          checked={draft.ssl.allowTls13}
                          onChange={(checked) =>
                            setDraft((prev) => ({
                              ...prev,
                              ssl: {
                                ...prev.ssl,
                                allowTls11: false,
                                allowTls13: checked,
                              },
                            }))
                          }
                        />
                      </div>
                    </div>

                    <SelectField
                      label={t('systemFoundation.ssl.cipherSuite')}
                      value={draft.ssl.cipherSuite}
                      options={CIPHER_SUITE_OPTIONS}
                      onChange={(v) =>
                        setDraft((prev) => ({
                          ...prev,
                          ssl: {
                            ...prev.ssl,
                            cipherSuite: v as typeof prev.ssl.cipherSuite,
                          },
                        }))
                      }
                    />
                  </div>
                </>
              ) : null}

              {section === 'security' ? (
                <>
                  <SectionTitle>{sectionLabel}</SectionTitle>
                  <div className="space-y-4">
                    <div className="rounded-xl border border-zinc-800 bg-[#101012] px-4 py-3">
                      <p className="mb-2 text-[12px] text-zinc-500">{t('systemFoundation.security.mechanism')}</p>
                      <ToggleRow
                        label={t('systemFoundation.security.dualConfirm')}
                        checked={draft.security.dualConfirmEnabled}
                        onChange={(checked) =>
                          setDraft((prev) => ({
                            ...prev,
                            security: {
                              ...prev.security,
                              dualConfirmEnabled: checked,
                            },
                          }))
                        }
                      />
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-[#101012] px-4 py-4">
                      <p className="mb-3 text-[12px] text-zinc-500">
                        {t('systemFoundation.security.auditLimits')}
                      </p>
                      <div className="space-y-4">
                        <ChipMultiSelectField
                          label={t('systemFoundation.security.auditorRoles')}
                          selectedIds={draft.security.auditorRoleIds}
                          options={AUDITOR_ROLE_OPTIONS}
                          placeholder={t('systemFoundation.security.pickRoles')}
                          onChange={(ids) =>
                            setDraft((prev) => ({
                              ...prev,
                              security: {
                                ...prev.security,
                                auditorRoleIds: ids,
                              },
                            }))
                          }
                        />
                        <SelectField
                          label={t('systemFoundation.security.approvalValidity')}
                          value={String(
                            draft.security.approvalValidityMinutes,
                          )}
                          options={APPROVAL_VALIDITY_OPTIONS}
                          onChange={(v) =>
                            setDraft((prev) => ({
                              ...prev,
                              security: {
                                ...prev.security,
                                approvalValidityMinutes: Number(
                                  v,
                                ) as typeof prev.security.approvalValidityMinutes,
                              },
                            }))
                          }
                        />
                        <SelectField
                          label={t('systemFoundation.security.timeoutAction')}
                          value={draft.security.timeoutAction}
                          options={TIMEOUT_ACTION_OPTIONS}
                          onChange={(v) =>
                            setDraft((prev) => ({
                              ...prev,
                              security: {
                                ...prev.security,
                                timeoutAction:
                                  v as typeof prev.security.timeoutAction,
                              },
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                </>
              ) : null}

              {section === 'mqtt' ? (
                <>
                  <SectionTitle>{sectionLabel}</SectionTitle>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <TextField
                        label={t('systemFoundation.mqtt.brokerHost')}
                        value={draft.mqtt.brokerHost}
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            mqtt: { ...prev.mqtt, brokerHost: v },
                          }))
                        }
                      />
                      <NumberStepperField
                        label={t('systemFoundation.mqtt.port')}
                        value={draft.mqtt.brokerPort}
                        min={1}
                        max={65535}
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            mqtt: { ...prev.mqtt, brokerPort: v },
                          }))
                        }
                      />
                      <SelectField
                        label={t('systemFoundation.mqtt.authMode')}
                        value={draft.mqtt.authMode}
                        options={MQTT_AUTH_MODE_OPTIONS}
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            mqtt: {
                              ...prev.mqtt,
                              authMode: v as typeof prev.mqtt.authMode,
                            },
                          }))
                        }
                      />
                      <SelectField
                        label={t('systemFoundation.mqtt.qos')}
                        value={String(draft.mqtt.qos)}
                        options={MQTT_QOS_OPTIONS}
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            mqtt: {
                              ...prev.mqtt,
                              qos: Number(v) as typeof prev.mqtt.qos,
                            },
                          }))
                        }
                      />
                      <TextField
                        label={t('systemFoundation.mqtt.clientPrefix')}
                        value={draft.mqtt.clientIdPrefix}
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            mqtt: { ...prev.mqtt, clientIdPrefix: v },
                          }))
                        }
                      />
                      <NumberStepperField
                        label={t('systemFoundation.mqtt.keepalive')}
                        value={draft.mqtt.keepaliveSeconds}
                        unit={t('systemFoundation.mqtt.seconds')}
                        min={10}
                        max={600}
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            mqtt: { ...prev.mqtt, keepaliveSeconds: v },
                          }))
                        }
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-4 border-t border-zinc-800 pt-4 md:grid-cols-2">
                      <TextField
                        label={t('systemFoundation.mqtt.username')}
                        value={draft.mqtt.username}
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            mqtt: { ...prev.mqtt, username: v },
                          }))
                        }
                      />
                      <TextField
                        label={t('systemFoundation.mqtt.password')}
                        type="password"
                        value={draft.mqtt.password}
                        placeholder="••••••••••••••••"
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            mqtt: { ...prev.mqtt, password: v },
                          }))
                        }
                      />
                    </div>
                  </div>
                </>
              ) : null}

              {section === 'globalParams' ? (
                <>
                  <SectionTitle>{sectionLabel}</SectionTitle>
                  <div className="space-y-4">
                    <ToggleRow
                      label={t('systemFoundation.globalParams.mapActiveSync')}
                      checked={draft.globalParams.mapActiveSyncEnabled}
                      onChange={(checked) =>
                        setDraft((prev) => ({
                          ...prev,
                          globalParams: {
                            ...prev.globalParams,
                            mapActiveSyncEnabled: checked,
                          },
                        }))
                      }
                    />
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <NumberStepperField
                        label="碰撞防護緩衝時間"
                        value={draft.globalParams.collisionProtectionSeconds}
                        unit={t('systemFoundation.mqtt.seconds')}
                        min={0}
                        max={600}
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            globalParams: {
                              ...prev.globalParams,
                              collisionProtectionSeconds: v,
                            },
                          }))
                        }
                      />
                      <NumberStepperField
                        label="預設車速上限"
                        value={draft.globalParams.defaultVehicleSpeedLimitKmh}
                        unit="km/h"
                        min={1}
                        max={200}
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            globalParams: {
                              ...prev.globalParams,
                              defaultVehicleSpeedLimitKmh: v,
                            },
                          }))
                        }
                      />
                      <NumberStepperField
                        label="事件資料保存天數"
                        value={draft.globalParams.eventRetentionDays}
                        unit={t('systemFoundation.backup.days')}
                        min={1}
                        max={3650}
                        onChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            globalParams: {
                              ...prev.globalParams,
                              eventRetentionDays: v,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            <SettingsFooter
              saving={saving}
              error={error}
              onCancel={onCancel}
              onSave={onSave}
            />
          </>
        )}
      </section>
    </div>
  )
}
