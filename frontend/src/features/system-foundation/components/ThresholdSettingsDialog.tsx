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
import { Button, CheckboxIndicator, cn, Dialog, IconButton, MENU_PANEL_CLASS, menuItemClass, Tabs, TextInput, InputNumber, tabPanelProps } from '../../../components/ui';

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
  // InputNumber 規格：Enter／失焦套用、超出範圍收斂、右側增減鈕
  return (
    <InputNumber
      ariaLabel={unit}
      value={Number.isFinite(value) ? value : 0}
      unit={unit}
      min={min}
      max={max}
      step={step}
      onChange={(next) => onChange(next ?? min)}
      fluid={false}
      className="w-32"
    />
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
        className="flex min-h-[34px] w-full items-center gap-2 rounded-lg border border-border-quaternary bg-surface-secondary px-3 py-1 text-left transition hover:border-border-tertiary"
      >
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {selected.length === 0 ? (
            <span className="text-body-s text-text-quaternary">
              {t('systemFoundation.threshold.pickNotifyees')}
            </span>
          ) : (
            selected.map((person) => (
              <span
                key={person.id}
                className="inline-flex items-center gap-1 rounded-md bg-surface-secondary px-2 py-1 text-body-xs text-text-primary"
                onClick={(e) => e.stopPropagation()}
              >
                <UserRound className="size-3.5 text-text-tertiary" />
                {person.name}
                <IconButton size="small" hierarchy="subordinate" variant="standard" className="ml-0.5" label={t('systemFoundation.threshold.removePerson', {
          name: person.name,
         })} onPress={(e) => {
          e.stopPropagation()
          onChange(selectedIds.filter((id) => id !== person.id))
         }} icon={<X />} />
              </span>
            ))
          )}
        </div>
        <ChevronDown className="size-4 shrink-0 text-text-quaternary" />
      </button>

      {open ? (
        <div className={cn(MENU_PANEL_CLASS, 'absolute left-0 right-0 top-[calc(100%+4px)] z-20')}>
          {DEFAULT_NOTIFYEE_OPTIONS.map((person) => {
            const checked = selectedIds.includes(person.id)
            return (
              <button
                key={person.id}
                type="button"
                role="option"
                aria-selected={checked}
                className={menuItemClass(checked)}
                onClick={() => {
                  onChange(
                    checked
                      ? selectedIds.filter((id) => id !== person.id)
                      : [...selectedIds, person.id],
                  )
                }}
              >
                <CheckboxIndicator checked={checked} />
                <UserRound className="size-3.5 text-text-quaternary" />
                {person.name}
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
    <Dialog
      title={t('systemFoundation.threshold.title')}
      onClose={onCancel}
      busy={saving}
      padded={false}
      widthClassName="max-w-[720px]"
      footer={
        <>
          {error ? (
            <p className="mr-auto max-w-[50%] truncate text-body-xs text-status-error-emphasis">
              {error}
            </p>
          ) : null}
          <Button hierarchy="subordinate" variant="tonal" onPress={onCancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onPress={() => onSave(draft)} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <Tabs
        idBase="threshold-metric"
        className="border-b border-border-quaternary px-3"
        value={metricTab}
        onChange={setMetricTab}
        items={THRESHOLD_METRIC_TABS.map((tab) => ({ id: tab.id, label: t(METRIC_LABEL_KEYS[tab.id]) }))}
      />

      <div {...tabPanelProps('threshold-metric', metricTab)} className="min-h-0 space-y-5 overflow-auto px-6 py-5">
        <label className="block space-y-2">
          <span className="text-body-xs text-text-tertiary">
            {t('systemFoundation.threshold.notifyees')}
          </span>
          <NotifyeePicker
            selectedIds={metric.notifyeeIds}
            onChange={(notifyeeIds) => patchMetric({ notifyeeIds })}
          />
        </label>

        <div className="space-y-2">
          <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_34px] gap-3 px-0.5 text-body-xs text-text-tertiary">
            <span>{t('systemFoundation.threshold.condition')}</span>
            <span>{t('systemFoundation.threshold.alertMessage')}</span>
            <span />
          </div>

          <div className="space-y-2">
            {metric.conditions.map((row, index) => (
              <div
                key={row.id}
                className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_34px] items-center gap-3"
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
                  <span className="text-text-quaternary">-</span>
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
                  <TextInput
                    value={row.message}
                    placeholder={t('systemFoundation.threshold.messagePlaceholder')}
                    onChange={(e) => {
                      const message = e.target.value
                      const conditions = metric.conditions.map((c, i) =>
                        i === index ? { ...c, message } : c,
                      )
                      patchMetric({ conditions })
                    }}
                    className="pr-9"
                  />
                  {row.message ? (
                    <IconButton
                      size="small"
                      hierarchy="subordinate"
                      variant="standard"
                      className="absolute right-0 top-0 h-[34px]"
                      label={t('systemFoundation.threshold.clearMessage')}
                      icon={<X />}
                      onPress={() => {
                        const conditions = metric.conditions.map((c, i) =>
                          i === index ? { ...c, message: '' } : c,
                        )
                        patchMetric({ conditions })
                      }}
                    />
                  ) : null}
                </div>

                <IconButton
                  size="small"
                  hierarchy="subordinate"
                  variant="standard"
                  disabled={metric.conditions.length <= 1}
                  label={t('systemFoundation.threshold.deleteCondition')}
                  icon={<X />}
                  onPress={() => {
                    if (metric.conditions.length <= 1) return
                    patchMetric({
                      conditions: metric.conditions.filter((_, i) => i !== index),
                    })
                  }}
                />
              </div>
            ))}
          </div>

          <Button
            variant="text"
            className="mt-1"
            leadingIcon={<Plus />}
            onPress={() =>
              patchMetric({
                conditions: [...metric.conditions, newThresholdCondition()],
              })
            }
          >
            {t('systemFoundation.threshold.addCondition')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
