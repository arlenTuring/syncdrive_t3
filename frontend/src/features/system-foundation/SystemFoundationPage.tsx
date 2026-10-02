import { useCallback, useEffect, useState } from 'react'
import { Filter, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  fetchMonitoringThresholds,
  fetchSystemHealthHistory,
  fetchSystemHealthSnapshot,
  saveMonitoringThresholds,
  type HealthHistoryRange,
  type HistoryPoint,
  type SystemHealthSnapshot,
} from './api/systemHealthApi'
import {
  DiskNetworkCard,
  MetricCard,
  ServiceStatusCard,
} from './components/HealthMetricCards'
import { HealthTrendChart } from './components/HealthTrendChart'
import { ThresholdSettingsDialog } from './components/ThresholdSettingsDialog'
import { SystemFoundationSettingsPanel } from './components/SystemFoundationSettingsPanel'
import {
  AdvancedManagementPanel,
  type AdvancedManagementSection,
} from './components/AdvancedManagementPanel'
import {
  createDefaultThresholdSettings,
  resolveWarnThreshold,
  type MonitoringThresholdSettings,
} from './thresholdSettings'

type TabKey = 'health' | 'settings' | 'advanced'

const RANGE_OPTIONS: Array<{ id: HealthHistoryRange; labelKey: string }> = [
  { id: '1h', labelKey: 'systemFoundation.range1h' },
  { id: '6h', labelKey: 'systemFoundation.range6h' },
  { id: '24h', labelKey: 'systemFoundation.range24h' },
]

function fmtPercent(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${Math.round(n)}%`
}

function fmtTemp(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${Math.round(n)} °C`
}

export function SystemFoundationPage({
  initialTab = 'health',
  initialAdvancedSection = 'dashboard',
}: {
  initialTab?: TabKey
  initialAdvancedSection?: AdvancedManagementSection
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<TabKey>(initialTab)
  const [range, setRange] = useState<HealthHistoryRange>('6h')
  const [snapshot, setSnapshot] = useState<SystemHealthSnapshot | null>(null)
  const [points, setPoints] = useState<HistoryPoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [thresholdOpen, setThresholdOpen] = useState(false)
  const [thresholdSettings, setThresholdSettings] =
    useState<MonitoringThresholdSettings>(() => createDefaultThresholdSettings())
  const [thresholdSaving, setThresholdSaving] = useState(false)
  const [thresholdError, setThresholdError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [snap, hist, thresholds] = await Promise.all([
        fetchSystemHealthSnapshot(),
        fetchSystemHealthHistory(range),
        fetchMonitoringThresholds(),
      ])
      setSnapshot(snap)
      setPoints(hist.points)
      setThresholdSettings(thresholds)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 10_000)
    return () => window.clearInterval(id)
  }, [refresh])

  const host = snapshot?.host
  const memoryWarnPercent = resolveWarnThreshold(
    thresholdSettings.memoryUsage,
    snapshot?.thresholds.memoryUsageWarnPercent ?? 80,
  )

  return (
    <div
      className={`flex h-full min-h-0 flex-col gap-4 p-5 ${
        tab === 'health' ? 'overflow-auto' : 'overflow-hidden'
      }`}
    >
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-800/80">
        <div className="flex items-center gap-1">
          {(
            [
              { id: 'health' as const, label: t('systemFoundation.tabHealth') },
              { id: 'settings' as const, label: t('systemFoundation.tabSettings') },
              { id: 'advanced' as const, label: t('systemFoundation.tabAdvanced') },
            ]
          ).map((item) => {
            const active = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`relative px-4 py-2.5 text-[13px] transition ${
                  active
                    ? 'font-medium text-sky-400'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {item.label}
                {active ? (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-sky-400" />
                ) : null}
              </button>
            )
          })}
        </div>
        {tab === 'health' ? (
          <button
            type="button"
            onClick={() => void refresh()}
            className="mb-1 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
            title={t('systemFoundation.refreshNow')}
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </button>
        ) : null}
      </div>

      {tab === 'advanced' ? (
        <AdvancedManagementPanel initialSection={initialAdvancedSection} />
      ) : tab === 'settings' ? (
        <SystemFoundationSettingsPanel />
      ) : (
        <>
          {error ? (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-[13px] text-rose-200">
              {error}
            </div>
          ) : null}

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-medium text-zinc-300">
                {t('systemFoundation.liveResources')}
              </h2>
              <button
                type="button"
                onClick={() => setThresholdOpen(true)}
                className="inline-flex size-8 items-center justify-center rounded-lg bg-zinc-800 text-zinc-200 transition hover:bg-zinc-700 hover:text-white"
                title={t('systemFoundation.filterThresholds')}
                aria-label={t('systemFoundation.filterThresholds')}
              >
                <Filter className="size-4" aria-hidden />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
              <MetricCard
                label={t('systemFoundation.health.cpuUsage')}
                value={fmtPercent(host?.cpuUsagePercent ?? null)}
                accent="#3b82f6"
                percent={host?.cpuUsagePercent ?? null}
              />
              <MetricCard
                label={t('systemFoundation.health.cpuTemp')}
                value={fmtTemp(host?.cpuTempC ?? null)}
                accent="#22d3ee"
                percent={
                  host?.cpuTempC != null
                    ? Math.min(100, (host.cpuTempC / 100) * 100)
                    : null
                }
              />
              <MetricCard
                label={t('systemFoundation.health.memoryUsage')}
                value={fmtPercent(host?.memoryUsagePercent ?? null)}
                accent="#22c55e"
                percent={host?.memoryUsagePercent ?? null}
              />
              <MetricCard
                label={t('systemFoundation.health.diskFree')}
                value={fmtPercent(host?.diskFreePercent ?? null)}
                accent="#a855f7"
                percent={host?.diskFreePercent ?? null}
                barMode="free"
              />
              <DiskNetworkCard
                readMBps={host?.diskReadMBps ?? null}
                writeMBps={host?.diskWriteMBps ?? null}
                latencyMs={host?.networkLatencyMs ?? null}
              />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-[13px] font-medium text-zinc-300">
              {t('systemFoundation.health.coreServices')}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(snapshot?.services ?? []).map((svc) => {
                const labelKey = `systemFoundation.health.services.${svc.id}`
                const statusMessage =
                  svc.status === 'ok'
                    ? t('systemFoundation.health.statusOk')
                    : svc.message === '連線失敗'
                      ? t('systemFoundation.health.statusFail')
                      : svc.message
                return (
                  <ServiceStatusCard
                    key={svc.id}
                    label={t(labelKey, { defaultValue: svc.label })}
                    detail={svc.detail}
                    ok={svc.status === 'ok'}
                    message={statusMessage}
                  />
                )
              })}
              {!snapshot?.services?.length && !error ? (
                <div className="col-span-full rounded-xl border border-zinc-800/80 bg-[#141416] px-4 py-8 text-center text-sm text-zinc-500">
                  {t('systemFoundation.health.loadingServices')}
                </div>
              ) : null}
            </div>
          </section>

          <section className="min-h-[340px] rounded-2xl border border-zinc-800/80 bg-[#141416] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[13px] font-medium text-zinc-300">
                {t('systemFoundation.health.historyTrend')}
              </h2>
              <div className="flex items-center gap-1 rounded-lg bg-zinc-900/80 p-0.5">
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setRange(opt.id)}
                    className={`rounded-md px-3 py-1.5 text-[12px] transition ${
                      range === opt.id
                        ? 'bg-zinc-700 text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {t(opt.labelKey)}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-4 text-[11px] text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#3b82f6]" />{' '}
                {t('systemFoundation.health.cpuUsage')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#22d3ee]" />{' '}
                {t('systemFoundation.health.cpuTemp')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#22c55e]" />{' '}
                {t('systemFoundation.health.memoryUsage')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#a855f7]" />{' '}
                {t('systemFoundation.health.diskFree')}
              </span>
            </div>
            <HealthTrendChart
              points={points}
              memoryWarnPercent={memoryWarnPercent}
            />
          </section>
        </>
      )}

      <ThresholdSettingsDialog
        open={thresholdOpen}
        initial={thresholdSettings}
        saving={thresholdSaving}
        error={thresholdError}
        onCancel={() => {
          if (thresholdSaving) return
          setThresholdError(null)
          setThresholdOpen(false)
        }}
        onSave={(next) => {
          setThresholdSaving(true)
          setThresholdError(null)
          void saveMonitoringThresholds(next)
            .then((saved) => {
              setThresholdSettings(saved)
              setThresholdOpen(false)
            })
            .catch((err) => {
              setThresholdError(
                err instanceof Error ? err.message : String(err),
              )
            })
            .finally(() => setThresholdSaving(false))
        }}
      />
    </div>
  )
}
