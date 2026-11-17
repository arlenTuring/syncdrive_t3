import { SiteSelect } from '../../../components/SiteSelect';
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
import { Button, IconButton } from '../../../components/ui';

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
    <section className="space-y-2.5 rounded-lg border border-status-warning-light bg-status-warning-light p-3">
      <h3 className="text-caption-2 uppercase text-status-warning">
        {t('mapEditor.signal.title')}
      </h3>

      <div className="flex items-center gap-3 rounded border border-border-quaternary bg-black-30 p-2">
        <img
          src={display.iconUrl}
          alt=""
          className="h-12 w-12 shrink-0 object-contain"
        />
        <span className="text-caption-2 text-text-quaternary">
          {t('mapEditor.signal.preview', {
            lamp: lampLabel(display.lamp),
            mount: mountLabel(mountDirection),
          })}
        </span>
      </div>

      <div>
        <label
          htmlFor="signal-mount"
          className="mb-1 block text-caption-2 text-text-quaternary"
        >
          {t('mapEditor.signal.mount')}
        </label>
        <SiteSelect
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
          size="sm" className="w-full"
        >
          {SIGNAL_MOUNT_DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {mountLabel(d)}
            </option>
          ))}
        </SiteSelect>
        <p className="mt-1 text-caption-2 text-text-disabled">
          {t('mapEditor.signal.mountHint')}
        </p>
      </div>

      <div>
        <label
          htmlFor="signal-default-lamp"
          className="mb-1 block text-caption-2 text-text-quaternary"
        >
          {t('mapEditor.signal.defaultLamp')}
        </label>
        <SiteSelect
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
          size="sm" className="w-full"
        >
          {SIGNAL_LAMPS.map((lamp) => (
            <option key={lamp} value={lamp}>
              {lampLabel(lamp)}
            </option>
          ))}
        </SiteSelect>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-caption-2 text-text-quaternary">
            {t('mapEditor.signal.rules')}
          </span>
          {!readOnly && (
            <Button hierarchy="subordinate" variant="outlined" leadingIcon={<Plus />} onPress={() =>
                setRules([
                  ...rules,
                  {
                    fieldPath: '',
                    operator: 'eq',
                    compareValue: '',
                    lamp: 'green',
                  },
                ])
              }>{t('mapEditor.signal.add')}</Button>
          )}
        </div>
        {rules.length === 0 ? (
          <p className="text-caption-2 text-text-disabled">{t('mapEditor.signal.noRules')}</p>
        ) : (
          <ul className="space-y-2">
            {rules.map((rule, idx) => (
              <li
                key={idx}
                className="flex flex-wrap items-center gap-2 rounded border border-border-quaternary bg-black-30 p-2"
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
                  className="min-w-[7rem] flex-1 rounded border border-border-tertiary bg-surface-primary px-2 py-1 font-mono text-body-xs text-text-primary outline-none focus:border-status-warning read-only:opacity-80"
                  placeholder={t('mapEditor.signal.fieldPlaceholder')}
                />
                <SiteSelect
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
                  size="sm"
                >
                  <option value="eq">=</option>
                  <option value="gt">&gt;</option>
                  <option value="lt">&lt;</option>
                </SiteSelect>
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
                  className="min-w-[3.5rem] flex-1 rounded border border-border-tertiary bg-surface-primary px-2 py-1 font-mono text-body-xs text-text-primary outline-none focus:border-status-warning read-only:opacity-80"
                  placeholder={t('mapEditor.signal.valuePlaceholder')}
                />
                <SiteSelect
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
                  size="sm"
                >
                  {SIGNAL_LAMPS.map((lamp) => (
                    <option key={lamp} value={lamp}>
                      {lampLabel(lamp)}
                    </option>
                  ))}
                </SiteSelect>
                <img
                  src={signalIconUrl(rule.lamp, mountDirection)}
                  alt=""
                  className="h-8 w-8 shrink-0 object-contain"
                />
                {!readOnly && (
                  <IconButton size="small" hierarchy="danger" variant="standard" onPress={() => setRules(rules.filter((_, i) => i !== idx))} label={t('mapEditor.signal.deleteRule')} icon={<Trash2 />} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <pre className="overflow-x-auto rounded border border-border-quaternary bg-surface-sub-background p-2 font-mono text-caption-2 text-text-quaternary">
        {t('mapEditor.signal.mqttExample', { id: facility.id })}
      </pre>
    </section>
  )
}
