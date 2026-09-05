import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-cyan-500/90">
        {title}
      </h3>
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
        <span
          className="inline-block size-4 rounded border border-zinc-600"
          style={{ backgroundColor: defaultFill }}
          title={t('mapEditor.fillColorRules.defaultTitle')}
        />
        <span>{t('mapEditor.fillColorRules.ruleCount', { count: rules.length })}</span>
      </div>
      <div>
        <label
          htmlFor={`${title}-default-fill`}
          className="mb-1 block text-[10px] text-zinc-500"
        >
          {t('mapEditor.fillColorRules.defaultLabel')}
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`${title}-default-fill`}
            type="color"
            disabled={readOnly}
            value={defaultFill}
            onChange={(e) => onDefaultFillChange(e.target.value)}
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="h-8 w-10 cursor-pointer rounded border border-zinc-600 bg-zinc-950 disabled:opacity-50"
          />
          <input
            type="text"
            readOnly={readOnly}
            value={defaultFill}
            onChange={(e) => onDefaultFillChange(e.target.value)}
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="flex-1 rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-cyan-500 read-only:opacity-80"
          />
        </div>
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] text-zinc-500">{t('mapEditor.fillColorRules.rulesLabel')}</span>
          {!readOnly && (
            <button
              type="button"
              onClick={() =>
                setRules([
                  ...rules,
                  { fieldPath: '', operator: 'eq', compareValue: '', color: '#22c55e' },
                ])
              }
              className="inline-flex items-center gap-1 rounded border border-zinc-600 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800"
            >
              <Plus className="size-3" /> {t('mapEditor.fillColorRules.add')}
            </button>
          )}
        </div>
        {rules.length === 0 ? (
          <p className="text-[10px] text-zinc-600">{t('mapEditor.fillColorRules.empty')}</p>
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
                  className="min-w-[8rem] flex-1 rounded border border-zinc-600 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-cyan-500 read-only:opacity-80"
                  placeholder={t('mapEditor.fillColorRules.fieldPlaceholder')}
                />
                <select
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
                  className="rounded border border-zinc-600 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-100 outline-none focus:border-cyan-500 disabled:opacity-60"
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
                  className="min-w-[4rem] flex-1 rounded border border-zinc-600 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-cyan-500 read-only:opacity-80"
                  placeholder={t('mapEditor.fillColorRules.valuePlaceholder')}
                />
                <input
                  type="color"
                  disabled={readOnly}
                  value={rule.color}
                  onChange={(e) => {
                    const next = [...rules]
                    next[idx] = { ...rule, color: e.target.value }
                    setRules(next)
                  }}
                  onFocus={onFieldFocus}
                  onBlur={onFieldBlur}
                  className="h-7 w-8 cursor-pointer rounded border border-zinc-600 disabled:opacity-50"
                />
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setRules(rules.filter((_, i) => i !== idx))}
                    className="rounded p-1 text-zinc-500 hover:bg-red-950/50 hover:text-red-400"
                    aria-label={t('mapEditor.fillColorRules.deleteAria')}
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
        {t('mapEditor.fillColorRules.mqttExample', { entityId })}
      </pre>
    </section>
  )
}
