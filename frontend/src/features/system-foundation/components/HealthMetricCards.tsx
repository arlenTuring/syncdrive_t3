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
    <div className="rounded-xl border border-zinc-800/80 bg-[#141416] px-4 py-3.5">
      <p className="text-[12px] text-zinc-400">{label}</p>
      <p className="mt-1 text-[28px] font-semibold tracking-tight text-zinc-50">
        {value}
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
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
    <div className="rounded-xl border border-zinc-800/80 bg-[#141416] px-4 py-3.5">
      <div className="flex h-full flex-col justify-center gap-2.5 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-zinc-400">{t('systemFoundation.health.read')}</span>
          <span className="font-medium tabular-nums text-zinc-100">
            {fmt(readMBps, 'MB/s')}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-zinc-400">{t('systemFoundation.health.write')}</span>
          <span className="font-medium tabular-nums text-zinc-100">
            {fmt(writeMBps, 'MB/s')}
          </span>
        </div>
        <div className="my-0.5 h-px bg-zinc-800" />
        <div className="flex items-center justify-between gap-3">
          <span className="text-zinc-400">
            {t('systemFoundation.health.networkLatency')}
          </span>
          <span className="font-medium tabular-nums text-zinc-100">
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
    <div className="rounded-xl border border-zinc-800/80 bg-[#141416] px-4 py-4">
      <p className="text-[13px] font-medium text-zinc-100">{label}</p>
      <p className="mt-1 text-[11px] text-zinc-500">{detail}</p>
      <div className="mt-4 flex items-center gap-2">
        <span
          className={`size-2.5 rounded-full ${
            ok ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.55)]' : 'bg-red-400'
          }`}
        />
        <span className={`text-[13px] ${ok ? 'text-emerald-300' : 'text-red-300'}`}>
          {message}
        </span>
      </div>
    </div>
  )
}
