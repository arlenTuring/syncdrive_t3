import { useTranslation } from 'react-i18next'

type MetricCardProps = {
  label: string
  value: string
  accent: string
  percent: number | null
  barMode?: 'usage' | 'free'
}

export function MetricCard({
  label,
  value,
  accent,
  percent,
  barMode = 'usage',
}: MetricCardProps) {
  const fill =
    percent == null
      ? 0
      : barMode === 'free'
        ? Math.min(100, Math.max(0, percent))
        : Math.min(100, Math.max(0, percent))

  return (
    <div className="rounded-xl border border-border-quaternary bg-surface-popup px-4 py-3.5">
      <p className="text-body-xs text-text-tertiary">{label}</p>
      <p className="mt-1 text-headline-2 text-text-primary">
        {value}
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-secondary">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${fill}%`,
            background: accent,
          }}
        />
      </div>
    </div>
  )
}

type IoCardProps = {
  readMBps: number | null
  writeMBps: number | null
  latencyMs: number | null
}

export function DiskNetworkCard({ readMBps, writeMBps, latencyMs }: IoCardProps) {
  const { t } = useTranslation()
  const fmt = (n: number | null, unit: string) =>
    n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(1)} ${unit}`

  return (
    <div className="rounded-xl border border-border-quaternary bg-surface-popup px-4 py-3.5">
      <div className="flex h-full flex-col justify-center gap-2.5 text-body-s">
        <div className="flex items-center justify-between gap-3">
          <span className="text-text-tertiary">{t('systemFoundation.health.read')}</span>
          <span className="font-medium tabular-nums text-text-primary">
            {fmt(readMBps, 'MB/s')}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-text-tertiary">{t('systemFoundation.health.write')}</span>
          <span className="font-medium tabular-nums text-text-primary">
            {fmt(writeMBps, 'MB/s')}
          </span>
        </div>
        <div className="my-0.5 h-px bg-surface-secondary" />
        <div className="flex items-center justify-between gap-3">
          <span className="text-text-tertiary">
            {t('systemFoundation.health.networkLatency')}
          </span>
          <span className="font-medium tabular-nums text-text-primary">
            {latencyMs == null ? '—' : `${latencyMs.toFixed(0)} ms`}
          </span>
        </div>
      </div>
    </div>
  )
}

type ServiceCardProps = {
  label: string
  detail: string
  ok: boolean
  message: string
}

export function ServiceStatusCard({
  label,
  detail,
  ok,
  message,
}: ServiceCardProps) {
  return (
    <div className="rounded-xl border border-border-quaternary bg-surface-popup px-4 py-4">
      <p className="text-body-s-bold text-text-primary">{label}</p>
      <p className="mt-1 text-body-xs text-text-quaternary">{detail}</p>
      <div className="mt-4 flex items-center gap-2">
        <span
          className={`size-2.5 rounded-full ${
            ok ? 'bg-status-success shadow-[0_0_8px_var(--status-success-light)]' : 'bg-status-error'
          }`}
        />
        <span className={`text-body-s ${ok ? 'text-status-success' : 'text-status-error-emphasis'}`}>
          {message}
        </span>
      </div>
    </div>
  )
}
