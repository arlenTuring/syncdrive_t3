import { SiteSelect } from '../../../components/SiteSelect';
import type { CanvasElementProps, DualCanvasGateOperator, WidgetDataBinding } from '../types';
import { WidgetDataBindingSettings } from '../elements/WidgetDataBindingSettings';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '../../../components/ui';

const inputCls = `w-full bg-surface-secondary border border-border-quaternary rounded-md px-2.5 py-1.5 text-text-primary text-body-xs
  focus:outline-none focus:border-border-theme focus:ring-1 focus:ring-border-theme-light transition-colors`;

const selectCls = `w-full bg-surface-secondary border border-border-quaternary rounded-md px-2 py-1.5 text-text-primary text-body-xs
  focus:outline-none focus:border-border-theme transition-colors cursor-pointer`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-text-quaternary text-caption-2 uppercase">{label}</label>
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
      <div className="p-2.5 rounded-lg bg-purple-950/30 border border-purple-700/40 text-caption-2 text-purple-200/90">
        {t('dashboard.dualCanvas.introBefore')}
        <strong className="text-purple-100">{t('dashboard.dualCanvas.defaultData')}</strong>
        {t('dashboard.dualCanvas.introMid')}
        <strong className="text-purple-100">{t('dashboard.dualCanvas.normalData')}</strong>
        {t('dashboard.dualCanvas.introAfter')}
      </div>

      <label className="flex items-center gap-2 text-body-xs text-text-secondary cursor-pointer">
        <Checkbox checked={el.dualCanvasEnabled !== false} onCheckedChange={e => onUpdate({
            dualCanvasEnabled: e,
            ...(e && !el.childrenNormal?.length
              ? { childrenNormal: [...(el.children ?? [])] }
              : {}),
            ...(e && !el.childrenDefault
              ? { childrenDefault: [] }
              : {}),
          })} />
        {t('dashboard.dualCanvas.enableDual')}
      </label>

      <label className="flex items-center gap-2 text-body-xs text-text-secondary cursor-pointer">
        <Checkbox checked={el.defaultPanelEnabled !== false} onCheckedChange={e => onUpdate({ defaultPanelEnabled: e })} />
        {t('dashboard.dualCanvas.enableDefault')}
      </label>

      <div className="pt-2 border-t border-border-quaternary space-y-3">
        <div className="text-caption-2 uppercase text-text-theme">
          {t('dashboard.dualCanvas.gateTitle')}
        </div>
        <p className="text-caption-2 text-text-quaternary">
          {t('dashboard.dualCanvas.gateHintBefore')}
          <code className="mx-0.5 text-text-tertiary">rowCount</code>
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
            <SiteSelect
              value={gate.operator ?? 'gte'}
              onChange={e => patchGate({ operator: e.target.value as DualCanvasGateOperator })}
              className={selectCls}
            >
              {OP_VALUES.map((value) => (
                <option key={value} value={value}>
                  {t(`dashboard.dualCanvas.ops.${value}`)}
                </option>
              ))}
            </SiteSelect>
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
        <p className="text-caption-2 text-text-disabled">
          {t('dashboard.dualCanvas.resultHint')}
        </p>
      </div>
    </div>
  );
}
