import { SiteColorInput } from '../../../components/SiteColorInput';
import { SiteSelect } from '../../../components/SiteSelect';
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '../../../components/ui';

export type FillColorRule = {
  fieldPath: string
  operator: 'eq' | 'gt' | 'lt'
  compareValue: string
  color: string
}

type Props = {
  title: string
  entityId: string
  readOnly: boolean
  defaultFill: string
  rules: FillColorRule[]
  onDefaultFillChange: (color: string) => void
  onRulesChange: (rules: FillColorRule[]) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

export function FillColorRulesSection({
  title,
  entityId,
  readOnly,
  defaultFill,
  rules,
  onDefaultFillChange,
  onRulesChange,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const { t } = useTranslation()
  const setRules = (next: FillColorRule[]) => {
    onRulesChange(next)
  }

  return (
    <section className="space-y-2.5 rounded-lg border border-cyan-900/40 bg-cyan-950/15 p-3">
      <h3 className="text-caption-2 uppercase text-cyan-500/90">
        {title}
      </h3>
      <div className="flex flex-wrap items-center gap-2 text-caption-2 text-text-quaternary">
        <span
          className="inline-block size-4 rounded border border-border-tertiary"
          style={{ backgroundColor: defaultFill }}
          title={t('mapEditor.fillColorRules.defaultTitle')}
        />
        <span>{t('mapEditor.fillColorRules.ruleCount', { count: rules.length })}</span>
      </div>
      <div>
        <label
          htmlFor={`${title}-default-fill`}
          className="mb-1 block text-caption-2 text-text-quaternary"
        >
          {t('mapEditor.fillColorRules.defaultLabel')}
        </label>
        <div className="flex items-center gap-2">
          <SiteColorInput
            id={`${title}-default-fill`}
            disabled={readOnly}
            value={defaultFill}
            onChange={(e) => onDefaultFillChange(e.target.value)}
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="h-8 w-10 cursor-pointer rounded border border-border-tertiary bg-surface-sub-background disabled:opacity-50"
           />
          <input
            type="text"
            readOnly={readOnly}
            value={defaultFill}
            onChange={(e) => onDefaultFillChange(e.target.value)}
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="flex-1 rounded border border-border-tertiary bg-surface-sub-background px-2 py-1 font-mono text-body-xs text-text-primary outline-none focus:border-border-theme read-only:opacity-80"
          />
        </div>
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-caption-2 text-text-quaternary">{t('mapEditor.fillColorRules.rulesLabel')}</span>
          {!readOnly && (
            <Button hierarchy="subordinate" variant="outlined" leadingIcon={<Plus />} onPress={() =>
                setRules([
                  ...rules,
                  { fieldPath: '', operator: 'eq', compareValue: '', color: '#22c55e' },
                ])
              }>{t('mapEditor.fillColorRules.add')}</Button>
          )}
        </div>
        {rules.length === 0 ? (
          <p className="text-caption-2 text-text-disabled">{t('mapEditor.fillColorRules.empty')}</p>
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
                  className="min-w-[8rem] flex-1 rounded border border-border-tertiary bg-surface-primary px-2 py-1 font-mono text-body-xs text-text-primary outline-none focus:border-border-theme read-only:opacity-80"
                  placeholder={t('mapEditor.fillColorRules.fieldPlaceholder')}
                />
                <SiteSelect
                  disabled={readOnly}
                  value={rule.operator}
                  onChange={(e) => {
                    const next = [...rules]
                    next[idx] = {
                      ...rule,
                      operator: e.target.value as 'eq' | 'gt' | 'lt',
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
                  className="min-w-[4rem] flex-1 rounded border border-border-tertiary bg-surface-primary px-2 py-1 font-mono text-body-xs text-text-primary outline-none focus:border-border-theme read-only:opacity-80"
                  placeholder={t('mapEditor.fillColorRules.valuePlaceholder')}
                />
                <SiteColorInput
                  disabled={readOnly}
                  value={rule.color}
                  onChange={(e) => {
                    const next = [...rules]
                    next[idx] = { ...rule, color: e.target.value }
                    setRules(next)
                  }}
                  onFocus={onFieldFocus}
                  onBlur={onFieldBlur}
                  className="h-7 w-8 cursor-pointer rounded border border-border-tertiary disabled:opacity-50"
                 />
                {!readOnly && (
                  <IconButton size="small" hierarchy="danger" variant="standard" onPress={() => setRules(rules.filter((_, i) => i !== idx))} label={t('mapEditor.fillColorRules.deleteAria')} icon={<Trash2 />} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <pre className="overflow-x-auto rounded border border-border-quaternary bg-surface-sub-background p-2 font-mono text-caption-2 text-text-quaternary">
        {t('mapEditor.fillColorRules.mqttExample', { entityId })}
      </pre>
    </section>
  )
}
