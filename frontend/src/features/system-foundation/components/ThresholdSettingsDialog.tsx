import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Plus, UserRound, X } from 'lucide-react'
import {
  cloneThresholdSettings,
  DEFAULT_NOTIFYEE_OPTIONS,
  newThresholdCondition,
  THRESHOLD_METRIC_TABS,
  type MonitoringThresholdSettings,
  type ThresholdMetricKey,
} from '../thresholdSettings'

type Props = {
  open: boolean
  initial: MonitoringThresholdSettings
  initialTab?: ThresholdMetricKey
  saving?: boolean
  error?: string | null
  onCancel: () => void
  onSave: (next: MonitoringThresholdSettings) => void
}

const METRIC_LABEL_KEYS: Record<ThresholdMetricKey, string> = {
  cpuUsage: 'systemFoundation.health.cpuUsage',
  cpuTemp: 'systemFoundation.health.cpuTemp',
  memoryUsage: 'systemFoundation.health.memoryUsage',
  diskFree: 'systemFoundation.health.diskFree',
}

function NumberStepper({
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  value: number
  unit: string
  min: number
  max: number
  step: number
  onChange: (n: number) => void
}) {
  const { t } = useTranslation()
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  return (
    <div className="flex h-10 min-w-[96px] items-stretch overflow-hidden rounded-lg border border-zinc-700 bg-[#1c1c1f]">
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value)
          onChange(Number.isFinite(n) ? clamp(n) : 0)
        }}
        className="w-14 bg-transparent px-2 text-center text-[13px] text-zinc-100 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="flex items-center pr-1 text-[12px] text-zinc-500">{unit}</span>
      <div className="flex w-6 flex-col border-l border-zinc-700">
        <button
          type="button"
          className="flex flex-1 items-center justify-center text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          onClick={() => onChange(clamp(value + step))}
          aria-label={t('systemFoundation.threshold.increment')}
        >
          <span className="text-[10px] leading-none">▴</span>
        </button>
        <button
          type="button"
          className="flex flex-1 items-center justify-center border-t border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          onClick={() => onChange(clamp(value - step))}
          aria-label={t('systemFoundation.threshold.decrement')}
        >
          <span className="text-[10px] leading-none">▾</span>
        </button>
      </div>
    </div>
  )
}

function NotifyeePicker({
  selectedIds,
  onChange,
}: {
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selected = DEFAULT_NOTIFYEE_OPTIONS.filter((o) =>
    selectedIds.includes(o.id),
  )

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-zinc-700 bg-[#1c1c1f] px-3 py-2 text-left transition hover:border-zinc-600"
      >
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {selected.length === 0 ? (
            <span className="text-[13px] text-zinc-500">
              {t('systemFoundation.threshold.pickNotifyees')}
            </span>
          ) : (
            selected.map((person) => (
              <span
                key={person.id}
                className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[12px] text-zinc-100"
                onClick={(e) => e.stopPropagation()}
              >
                <UserRound className="size-3.5 text-zinc-400" />
                {person.name}
                <button
                  type="button"
                  className="ml-0.5 rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
                  aria-label={t('systemFoundation.threshold.removePerson', {
                    name: person.name,
                  })}
                  onClick={(e) => {
                    e.stopPropagation()
                    onChange(selectedIds.filter((id) => id !== person.id))
                  }}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))
          )}
        </div>
        <ChevronDown className="size-4 shrink-0 text-zinc-500" />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-lg border border-zinc-700 bg-[#1a1a1d] py-1 shadow-xl">
          {DEFAULT_NOTIFYEE_OPTIONS.map((person) => {
            const checked = selectedIds.includes(person.id)
            return (
              <button
                key={person.id}
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition hover:bg-white/5 ${
                  checked ? 'text-sky-300' : 'text-zinc-200'
                }`}
                onClick={() => {
                  onChange(
                    checked
                      ? selectedIds.filter((id) => id !== person.id)
                      : [...selectedIds, person.id],
                  )
                }}
              >
                <UserRound className="size-3.5 text-zinc-500" />
                {person.name}
                {checked ? (
                  <span className="ml-auto text-[11px] text-sky-400">
                    {t('systemFoundation.threshold.selected')}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function ThresholdSettingsDialog({
  open,
  initial,
  initialTab = 'cpuUsage',
  saving = false,
  error = null,
  onCancel,
  onSave,
}: Props) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(() => cloneThresholdSettings(initial))
  const [metricTab, setMetricTab] = useState<ThresholdMetricKey>(initialTab)

  useEffect(() => {
    if (!open) return
    setDraft(cloneThresholdSettings(initial))
    setMetricTab(initialTab)
  }, [open, initial, initialTab])

  const meta = useMemo(
    () => THRESHOLD_METRIC_TABS.find((tab) => tab.id === metricTab)!,
    [metricTab],
  )
  const metric = draft[metricTab]

  if (!open) return null

  const patchMetric = (
    patch: Partial<(typeof draft)[ThresholdMetricKey]>,
  ) => {
    setDraft((prev) => ({
      ...prev,
      [metricTab]: { ...prev[metricTab], ...patch },
    }))
  }

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-labelledby="threshold-settings-title"
        className="flex w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-zinc-700/90 bg-[#18181b] shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h2
            id="threshold-settings-title"
            className="text-[15px] font-semibold text-zinc-50"
          >
            {t('systemFoundation.threshold.title')}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
            aria-label={t('common.close')}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-2 flex gap-1 border-b border-zinc-800 px-3">
          {THRESHOLD_METRIC_TABS.map((tab) => {
            const active = metricTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMetricTab(tab.id)}
                className={`relative px-3 py-2.5 text-[13px] transition ${
                  active
                    ? 'font-medium text-sky-400'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t(METRIC_LABEL_KEYS[tab.id])}
                {active ? (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-sky-400" />
                ) : null}
              </button>
            )
          })}
        </div>

        <div className="space-y-5 px-5 py-5">
          <label className="block space-y-2">
            <span className="text-[12px] text-zinc-400">
              {t('systemFoundation.threshold.notifyees')}
            </span>
            <NotifyeePicker
              selectedIds={metric.notifyeeIds}
              onChange={(notifyeeIds) => patchMetric({ notifyeeIds })}
            />
          </label>

          <div className="space-y-2">
            <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_28px] gap-3 px-0.5 text-[12px] text-zinc-400">
              <span>{t('systemFoundation.threshold.condition')}</span>
              <span>{t('systemFoundation.threshold.alertMessage')}</span>
              <span />
            </div>

            <div className="space-y-2">
              {metric.conditions.map((row, index) => (
                <div
                  key={row.id}
                  className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_28px] items-center gap-3"
                >
                  <div className="flex items-center gap-2">
                    <NumberStepper
                      value={row.min}
                      unit={meta.unit}
                      min={meta.min}
                      max={meta.max}
                      step={meta.step}
                      onChange={(min) => {
                        const conditions = metric.conditions.map((c, i) =>
                          i === index ? { ...c, min } : c,
                        )
                        patchMetric({ conditions })
                      }}
                    />
                    <span className="text-zinc-500">-</span>
                    <NumberStepper
                      value={row.max}
                      unit={meta.unit}
                      min={meta.min}
                      max={meta.max}
                      step={meta.step}
                      onChange={(max) => {
                        const conditions = metric.conditions.map((c, i) =>
                          i === index ? { ...c, max } : c,
                        )
                        patchMetric({ conditions })
                      }}
                    />
                  </div>

                  <div className="relative">
                    <input
                      value={row.message}
                      placeholder={t('systemFoundation.threshold.messagePlaceholder')}
                      onChange={(e) => {
                        const message = e.target.value
                        const conditions = metric.conditions.map((c, i) =>
                          i === index ? { ...c, message } : c,
                        )
                        patchMetric({ conditions })
                      }}
                      className="h-10 w-full rounded-lg border border-zinc-700 bg-[#1c1c1f] px-3 pr-8 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500/70"
                    />
                    {row.message ? (
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-500 hover:text-zinc-200"
                        aria-label={t('systemFoundation.threshold.clearMessage')}
                        onClick={() => {
                          const conditions = metric.conditions.map((c, i) =>
                            i === index ? { ...c, message: '' } : c,
                          )
                          patchMetric({ conditions })
                        }}
                      >
                        <X className="size-3.5" />
                      </button>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    disabled={metric.conditions.length <= 1}
                    onClick={() => {
                      if (metric.conditions.length <= 1) return
                      patchMetric({
                        conditions: metric.conditions.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }}
                    className="inline-flex size-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label={t('systemFoundation.threshold.deleteCondition')}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() =>
                patchMetric({
                  conditions: [...metric.conditions, newThresholdCondition()],
                })
              }
              className="inline-flex items-center gap-1 pt-1 text-[13px] font-medium text-sky-400 transition hover:text-sky-300"
            >
              <Plus className="size-4" />
              {t('systemFoundation.threshold.addCondition')}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-zinc-800 px-5 py-4">
          {error ? (
            <p className="mr-auto max-w-[50%] truncate text-[12px] text-rose-300">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-[13px] text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            disabled={saving}
            className="rounded-lg bg-[#2B7FFF] px-5 py-2 text-[13px] font-medium text-white transition hover:bg-[#1f6fe0] disabled:opacity-50"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
