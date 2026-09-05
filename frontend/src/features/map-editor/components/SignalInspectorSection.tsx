import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FacilityObject } from '../types/facility'
import {
  parseSignalIconRules,
  parseSignalLamp,
  parseSignalMountDirection,
  resolveSignalDisplay,
  SIGNAL_LAMPS,
  SIGNAL_MOUNT_DIRECTIONS,
  signalIconUrl,
  type SignalIconRule,
  type SignalLamp,
  type SignalMountDirection,
} from '../utils/signalFacility'

type Props = {
  facility: FacilityObject
  readOnly: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

export function SignalInspectorSection({
  facility,
  readOnly,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const { t } = useTranslation()

  if (facility.type !== 'Signal') return null

  const lampLabel = (lamp: SignalLamp) => t(`mapEditor.signal.lamp.${lamp}`)
  const mountLabel = (dir: SignalMountDirection) =>
    t(`mapEditor.signal.mountDir.${dir}`)

  const params = facility.parameters ?? {}
  const mountDirection = parseSignalMountDirection(params.mountDirection)
  const defaultLamp = parseSignalLamp(params.defaultLamp) ?? 'offline'
  const rules = parseSignalIconRules(params.iconRules)
  const display = resolveSignalDisplay(facility)

  const setRules = (next: SignalIconRule[]) => {
    onPatchParameters({
      iconRules: next.length > 0 ? next : undefined,
    })
  }

  return (
    <section className="space-y-2.5 rounded-lg border border-amber-900/40 bg-amber-950/12 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-amber-500/90">
        {t('mapEditor.signal.title')}
      </h3>

      <div className="flex items-center gap-3 rounded border border-zinc-700/80 bg-zinc-950/60 p-2">
        <img
          src={display.iconUrl}
          alt=""
          className="h-12 w-12 shrink-0 object-contain"
        />
        <span className="text-[10px] text-zinc-500">
          {t('mapEditor.signal.preview', {
            lamp: lampLabel(display.lamp),
            mount: mountLabel(mountDirection),
          })}
        </span>
      </div>

      <div>
        <label
          htmlFor="signal-mount"
          className="mb-1 block text-[10px] text-zinc-500"
        >
          {t('mapEditor.signal.mount')}
        </label>
        <select
          id="signal-mount"
          disabled={readOnly}
          value={mountDirection}
          onChange={(e) =>
            onPatchParameters({
              mountDirection: e.target.value as SignalMountDirection,
            })
          }
          onFocus={onFieldFocus}
          onBlur={onFieldBlur}
          className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-100 outline-none focus:border-amber-500 disabled:opacity-60"
        >
          {SIGNAL_MOUNT_DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {mountLabel(d)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[10px] text-zinc-600">
          {t('mapEditor.signal.mountHint')}
        </p>
      </div>

      <div>
        <label
          htmlFor="signal-default-lamp"
          className="mb-1 block text-[10px] text-zinc-500"
        >
          {t('mapEditor.signal.defaultLamp')}
        </label>
        <select
          id="signal-default-lamp"
          disabled={readOnly}
          value={defaultLamp}
          onChange={(e) =>
            onPatchParameters({
              defaultLamp: e.target.value as SignalLamp,
            })
          }
          onFocus={onFieldFocus}
          onBlur={onFieldBlur}
          className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-100 outline-none focus:border-amber-500 disabled:opacity-60"
        >
          {SIGNAL_LAMPS.map((lamp) => (
            <option key={lamp} value={lamp}>
              {lampLabel(lamp)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] text-zinc-500">
            {t('mapEditor.signal.rules')}
          </span>
          {!readOnly && (
            <button
              type="button"
              onClick={() =>
                setRules([
                  ...rules,
                  {
                    fieldPath: '',
                    operator: 'eq',
                    compareValue: '',
                    lamp: 'green',
                  },
                ])
              }
              className="inline-flex items-center gap-1 rounded border border-zinc-600 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800"
            >
              <Plus className="size-3" /> {t('mapEditor.signal.add')}
            </button>
          )}
        </div>
        {rules.length === 0 ? (
          <p className="text-[10px] text-zinc-600">{t('mapEditor.signal.noRules')}</p>
        ) : (
          <ul className="space-y-2">
            {rules.map((rule, idx) => (
              <li
                key={idx}
                className="flex flex-wrap items-center gap-2 rounded border border-zinc-700/80 bg-zinc-950/60 p-2"
              >
                <input
                  readOnly={readOnly}
                  value={rule.fieldPath}
                  onChange={(e) => {
                    const next = [...rules]
                    next[idx] = { ...rule, fieldPath: e.target.value }
                    setRules(next)
                  }}
                  onFocus={onFieldFocus}
                  onBlur={onFieldBlur}
                  className="min-w-[7rem] flex-1 rounded border border-zinc-600 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-amber-500 read-only:opacity-80"
                  placeholder={t('mapEditor.signal.fieldPlaceholder')}
                />
                <select
                  disabled={readOnly}
                  value={rule.operator}
                  onChange={(e) => {
                    const next = [...rules]
                    next[idx] = {
                      ...rule,
                      operator: e.target.value as SignalIconRule['operator'],
                    }
                    setRules(next)
                  }}
                  onFocus={onFieldFocus}
                  onBlur={onFieldBlur}
                  className="rounded border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-100 outline-none focus:border-amber-500 disabled:opacity-60"
                >
                  <option value="eq">=</option>
                  <option value="gt">&gt;</option>
                  <option value="lt">&lt;</option>
                </select>
                <input
                  readOnly={readOnly}
                  value={rule.compareValue}
                  onChange={(e) => {
                    const next = [...rules]
                    next[idx] = { ...rule, compareValue: e.target.value }
                    setRules(next)
                  }}
                  onFocus={onFieldFocus}
                  onBlur={onFieldBlur}
                  className="min-w-[3.5rem] flex-1 rounded border border-zinc-600 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-amber-500 read-only:opacity-80"
                  placeholder={t('mapEditor.signal.valuePlaceholder')}
                />
                <select
                  disabled={readOnly}
                  value={rule.lamp}
                  onChange={(e) => {
                    const next = [...rules]
                    next[idx] = {
                      ...rule,
                      lamp: e.target.value as SignalLamp,
                    }
                    setRules(next)
                  }}
                  onFocus={onFieldFocus}
                  onBlur={onFieldBlur}
                  className="rounded border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-100 outline-none focus:border-amber-500 disabled:opacity-60"
                >
                  {SIGNAL_LAMPS.map((lamp) => (
                    <option key={lamp} value={lamp}>
                      {lampLabel(lamp)}
                    </option>
                  ))}
                </select>
                <img
                  src={signalIconUrl(rule.lamp, mountDirection)}
                  alt=""
                  className="h-8 w-8 shrink-0 object-contain"
                />
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setRules(rules.filter((_, i) => i !== idx))}
                    className="rounded p-1 text-zinc-500 hover:bg-red-950/50 hover:text-red-400"
                    aria-label={t('mapEditor.signal.deleteRule')}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <pre className="overflow-x-auto rounded border border-zinc-700/80 bg-zinc-950/80 p-2 font-mono text-[9px] leading-relaxed text-zinc-500">
        {t('mapEditor.signal.mqttExample', { id: facility.id })}
      </pre>
    </section>
  )
}
