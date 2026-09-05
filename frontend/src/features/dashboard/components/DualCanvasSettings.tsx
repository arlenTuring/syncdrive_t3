import type { CanvasElementProps, DualCanvasGateOperator, WidgetDataBinding } from '../types';
import { WidgetDataBindingSettings } from '../elements/WidgetDataBindingSettings';
import { useTranslation } from 'react-i18next';

const inputCls = `w-full bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-zinc-200 text-xs
  focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 transition-colors`;

const selectCls = `w-full bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1.5 text-zinc-200 text-xs
  focus:outline-none focus:border-cyan-500 transition-colors cursor-pointer`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-zinc-500 text-[10px] uppercase font-bold tracking-tight">{label}</label>
      {children}
    </div>
  );
}

const OP_VALUES: DualCanvasGateOperator[] = [
  'gte',
  'gt',
  'lte',
  'lt',
  'eq',
  'neq',
  'not_empty',
  'empty',
];

export function DualCanvasSettings({
  el,
  onUpdate,
}: {
  el: CanvasElementProps;
  onUpdate: (patch: Partial<CanvasElementProps>) => void;
}) {
  const { t } = useTranslation();
  const gate = el.displayGate ?? { signal: 'rowCount', operator: 'gte', compareValue: '1' };
  const indexVar = el.variableName || 'item';

  const patchGate = (p: Partial<typeof gate>) =>
    onUpdate({ displayGate: { ...gate, ...p } });

  return (
    <div className="space-y-4">
      <div className="p-2.5 rounded-lg bg-purple-950/30 border border-purple-700/40 text-[10px] text-purple-200/90 leading-relaxed">
        {t('dashboard.dualCanvas.introBefore')}
        <strong className="text-purple-100">{t('dashboard.dualCanvas.defaultData')}</strong>
        {t('dashboard.dualCanvas.introMid')}
        <strong className="text-purple-100">{t('dashboard.dualCanvas.normalData')}</strong>
        {t('dashboard.dualCanvas.introAfter')}
      </div>

      <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
        <input
          type="checkbox"
          checked={el.dualCanvasEnabled !== false}
          onChange={e => onUpdate({
            dualCanvasEnabled: e.target.checked,
            ...(e.target.checked && !el.childrenNormal?.length
              ? { childrenNormal: [...(el.children ?? [])] }
              : {}),
            ...(e.target.checked && !el.childrenDefault
              ? { childrenDefault: [] }
              : {}),
          })}
          className="accent-purple-500 w-3.5 h-3.5"
        />
        {t('dashboard.dualCanvas.enableDual')}
      </label>

      <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
        <input
          type="checkbox"
          checked={el.defaultPanelEnabled !== false}
          onChange={e => onUpdate({ defaultPanelEnabled: e.target.checked })}
          className="accent-cyan-500 w-3.5 h-3.5"
        />
        {t('dashboard.dualCanvas.enableDefault')}
      </label>

      <div className="pt-2 border-t border-zinc-800 space-y-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
          {t('dashboard.dualCanvas.gateTitle')}
        </div>
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          {t('dashboard.dualCanvas.gateHintBefore')}
          <code className="mx-0.5 text-zinc-400">rowCount</code>
          {t('dashboard.dualCanvas.gateHintMid')}
          <code className="mx-0.5 text-purple-300">{`{${indexVar}}`}</code>
          {t('dashboard.dualCanvas.gateHintAfter')}
        </p>

        <Field label={t('dashboard.dualCanvas.gateSql')}>
          <WidgetDataBindingSettings
            w={{
              dataSourceId: gate.dataSourceId ?? el.dataSourceId,
              sqlQuery: gate.sqlQuery ?? '',
              refreshInterval: gate.refreshInterval ?? el.refreshInterval,
            }}
            onUpdate={(p: Partial<WidgetDataBinding>) => patchGate({
              dataSourceId: p.dataSourceId,
              sqlQuery: p.sqlQuery,
              refreshInterval: p.refreshInterval,
            })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label={t('dashboard.dualCanvas.signal')}>
            <input
              value={gate.signal ?? 'rowCount'}
              onChange={e => patchGate({ signal: e.target.value })}
              className={inputCls}
              placeholder={t('dashboard.dualCanvas.signalPlaceholder')}
            />
          </Field>
          <Field label={t('dashboard.dualCanvas.operator')}>
            <select
              value={gate.operator ?? 'gte'}
              onChange={e => patchGate({ operator: e.target.value as DualCanvasGateOperator })}
              className={selectCls}
            >
              {OP_VALUES.map((value) => (
                <option key={value} value={value}>
                  {t(`dashboard.dualCanvas.ops.${value}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('dashboard.dualCanvas.compareValue')}>
            <input
              value={gate.compareValue ?? '1'}
              onChange={e => patchGate({ compareValue: e.target.value })}
              className={inputCls}
              placeholder="1"
            />
          </Field>
        </div>
        <p className="text-[10px] text-zinc-600">
          {t('dashboard.dualCanvas.resultHint')}
        </p>
      </div>
    </div>
  );
}
