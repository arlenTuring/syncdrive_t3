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
import { Button, IconButton, SegmentedControl, Tabs } from '../../components/ui';
import { HEALTH_SERIES_COLOR } from './components/healthSeriesColors';

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
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border-quaternary">
        <Tabs
          label={t('systemFoundation.title', { defaultValue: '系統基礎模組' })}
          value={tab}
          onChange={setTab}
          items={[
            { id: 'health' as const, label: t('systemFoundation.tabHealth') },
            { id: 'settings' as const, label: t('systemFoundation.tabSettings') },
            { id: 'advanced' as const, label: t('systemFoundation.tabAdvanced') },
          ]}
        />
        {tab === 'health' ? (
          <Button
            hierarchy="subordinate"
            variant="standard"
            className="mb-1"
            onPress={() => void refresh()}
            title={t('systemFoundation.refreshNow')}
            leadingIcon={<RefreshCw className={loading ? 'animate-spin' : undefined} />}
          >
            {t('common.refresh')}
          </Button>
        ) : null}
      </div>

      {tab === 'advanced' ? (
        <AdvancedManagementPanel initialSection={initialAdvancedSection} />
      ) : tab === 'settings' ? (
        <SystemFoundationSettingsPanel />
      ) : (
        <>
          {error ? (
            <div className="rounded-lg border border-border-danger-light bg-status-error-light px-4 py-3 text-body-s text-status-error-emphasis">
              {error}
            </div>
          ) : null}

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-body-s-bold text-text-secondary">
                {t('systemFoundation.liveResources')}
              </h2>
              <IconButton
                size="small"
                hierarchy="subordinate"
                variant="tonal"
                onPress={() => setThresholdOpen(true)}
                label={t('systemFoundation.filterThresholds')}
                icon={<Filter />}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
              <MetricCard
                label={t('systemFoundation.health.cpuUsage')}
                value={fmtPercent(host?.cpuUsagePercent ?? null)}
                accent={HEALTH_SERIES_COLOR.cpuUsagePercent}
                percent={host?.cpuUsagePercent ?? null}
              />
              <MetricCard
                label={t('systemFoundation.health.cpuTemp')}
                value={fmtTemp(host?.cpuTempC ?? null)}
                accent={HEALTH_SERIES_COLOR.cpuTempC}
                percent={
                  host?.cpuTempC != null
                    ? Math.min(100, (host.cpuTempC / 100) * 100)
                    : null
                }
              />
              <MetricCard
                label={t('systemFoundation.health.memoryUsage')}
                value={fmtPercent(host?.memoryUsagePercent ?? null)}
                accent={HEALTH_SERIES_COLOR.memoryUsagePercent}
                percent={host?.memoryUsagePercent ?? null}
              />
              <MetricCard
                label={t('systemFoundation.health.diskFree')}
                value={fmtPercent(host?.diskFreePercent ?? null)}
                accent={HEALTH_SERIES_COLOR.diskFreePercent}
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
            <h2 className="mb-3 text-body-s-bold text-text-secondary">
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
                <div className="col-span-full rounded-xl border border-border-quaternary bg-surface-popup px-4 py-8 text-center text-body-s text-text-quaternary">
                  {t('systemFoundation.health.loadingServices')}
                </div>
              ) : null}
            </div>
          </section>

          <section className="min-h-[340px] rounded-2xl border border-border-quaternary bg-surface-popup p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-body-s-bold text-text-secondary">
                {t('systemFoundation.health.historyTrend')}
              </h2>
              <SegmentedControl
                label={t('systemFoundation.health.historyTrend')}
                value={range}
                onChange={setRange}
                options={RANGE_OPTIONS.map((opt) => ({ id: opt.id, label: t(opt.labelKey) }))}
              />
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-4 text-body-xs text-text-tertiary">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: HEALTH_SERIES_COLOR.cpuUsagePercent }} />{' '}
                {t('systemFoundation.health.cpuUsage')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: HEALTH_SERIES_COLOR.cpuTempC }} />{' '}
                {t('systemFoundation.health.cpuTemp')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: HEALTH_SERIES_COLOR.memoryUsagePercent }} />{' '}
                {t('systemFoundation.health.memoryUsage')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: HEALTH_SERIES_COLOR.diskFreePercent }} />{' '}
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
