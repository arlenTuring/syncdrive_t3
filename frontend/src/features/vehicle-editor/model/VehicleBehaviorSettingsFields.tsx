import { SiteSelect } from '../../../components/SiteSelect';
import { Plus, Trash2, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NumberInput } from '../../../components/NumberInput';
import type { RouteActionIconRule, RouteActionMatchOp } from '../../dashboard/types';
import {
  buildVehicleBehaviorActionRules,
  VEHICLE_BEHAVIOR_ACTION_CATALOG,
} from '../constants/behaviorActionCatalog';

/** 車輛行為圖示的設定值（地圖車輛模型設定、儀表板獨立載具容器共用） */
export type VehicleBehaviorSettings = {
  actionIconRules?: RouteActionIconRule[];
  behaviorOffsetX?: number;
  behaviorOffsetY?: number;
  behaviorIconSize?: number;
};

const inputCls = `w-full bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-zinc-200 text-xs
  focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 transition-colors`;
const selectCls = `w-full bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1.5 text-zinc-200 text-xs
  focus:outline-none focus:border-cyan-500 transition-colors cursor-pointer`;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[10px] font-bold uppercase tracking-tight text-zinc-500">{label}</label>
      {children}
    </div>
  );
}

/**
 * 行為圖示：位置偏移、大小、依即時資料顯示哪個圖示的規則。
 * 原本只在儀表板載具容器的屬性面板裡；地圖車輛的行為設定搬到圖資管理後兩邊共用這一份。
 */
export function VehicleBehaviorSettingsFields({
  value,
  onChange,
  header,
}: {
  value: VehicleBehaviorSettings;
  onChange: (patch: Partial<VehicleBehaviorSettings>) => void;
  /** 區塊標題列（省略時用預設標題） */
  header?: ReactNode;
}) {
  const { t } = useTranslation();
  const rules = value.actionIconRules ?? [];

  const updateRule = (idx: number, patch: Partial<RouteActionIconRule>) => {
    const next = [...rules];
    next[idx] = { ...next[idx], ...patch };
    onChange({ actionIconRules: next });
  };

  const ACTION_MATCH_OPS: { value: RouteActionMatchOp; label: string }[] = [
    { value: 'eq', label: t('dashboard.properties.widgets.vehicleContainer.matchEq') },
    { value: 'gte', label: '≥' },
    { value: 'gt', label: '>' },
    { value: 'present', label: t('dashboard.properties.widgets.vehicleContainer.matchPresent') },
  ];

  return (
    <div className="space-y-3">
      {header ?? (
        <div className="flex items-center gap-1.5 border-b border-zinc-800 pb-1 text-xs font-semibold uppercase tracking-wider text-violet-400">
          <Zap size={14} /> {t('dashboard.properties.widgets.vehicleContainer.actions')}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Field label={t('dashboard.properties.widgets.vehicleContainer.offsetX')}>
          <NumberInput
            value={value.behaviorOffsetX ?? 0}
            onChange={(n) => onChange({ behaviorOffsetX: n })}
            className={inputCls}
          />
        </Field>
        <Field label={t('dashboard.properties.widgets.vehicleContainer.offsetY')}>
          <NumberInput
            value={value.behaviorOffsetY ?? -28}
            onChange={(n) => onChange({ behaviorOffsetY: n })}
            className={inputCls}
          />
        </Field>
        <Field label={t('dashboard.properties.widgets.vehicleContainer.iconSize')}>
          <input
            type="range"
            min={8}
            max={64}
            step={1}
            value={value.behaviorIconSize ?? 20}
            onChange={(e) => onChange({ behaviorIconSize: Number(e.target.value) })}
            className="w-full accent-violet-500"
          />
          <div className="mt-1 flex items-center gap-2">
            <NumberInput
              min={8}
              max={64}
              value={value.behaviorIconSize ?? 20}
              onChange={(n) =>
                onChange({
                  behaviorIconSize: Math.min(64, Math.max(8, n || 20)),
                })
              }
              className={inputCls}
            />
            <span className="shrink-0 text-[9px] text-zinc-500">{t('dashboard.properties.widgets.vehicleContainer.iconSizeHint')}</span>
          </div>
        </Field>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-zinc-400">{t('dashboard.properties.widgets.vehicleContainer.actionRules')}</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onChange({ actionIconRules: buildVehicleBehaviorActionRules('operation_action') })}
              className="rounded bg-zinc-800 px-2 py-0.5 text-[9px] text-zinc-400 hover:text-amber-400"
            >
              {t('dashboard.properties.widgets.vehicleContainer.catalog11')}
            </button>
            <button
              type="button"
              onClick={() =>
                onChange({
                  actionIconRules: [
                    ...rules,
                    {
                      id: `act_${Date.now()}`,
                      sourceVarKey: 'operation_action',
                      matchOp: 'eq',
                      threshold: 'charging',
                      iconFile: 'behaviors/charging.svg',
                    },
                  ],
                })
              }
              className="rounded p-1 text-amber-500 hover:bg-zinc-800"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        {rules.length === 0 && (
          <p className="text-[9px] text-zinc-600">
            {t('dashboard.properties.widgets.vehicleContainer.rulesHint')}
          </p>
        )}
        {rules.map((rule, i) => (
          <div key={rule.id} className="space-y-1.5 rounded border border-zinc-700/50 bg-zinc-800/30 p-2">
            <div className="flex gap-1">
              <SiteSelect
                value={rule.iconFile}
                onChange={(e) => {
                  const cat = VEHICLE_BEHAVIOR_ACTION_CATALOG.find((c) => c.iconFile === e.target.value);
                  updateRule(i, {
                    iconFile: e.target.value,
                    threshold: cat?.code ?? rule.threshold,
                    label: cat?.label ?? rule.label,
                  });
                }}
                className={selectCls}
                style={{ fontSize: 10 }}
              >
                {VEHICLE_BEHAVIOR_ACTION_CATALOG.map((c) => (
                  <option key={c.code} value={c.iconFile}>
                    {c.label}
                  </option>
                ))}
              </SiteSelect>
              <button
                type="button"
                onClick={() => onChange({ actionIconRules: rules.filter((_, j) => j !== i) })}
                className="p-1 text-zinc-500 hover:text-red-400"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <input
              value={rule.sourceVarKey}
              onChange={(e) => updateRule(i, { sourceVarKey: e.target.value })}
              className={inputCls}
              placeholder={t('dashboard.properties.widgets.vehicleContainer.varKeyPlaceholder')}
              style={{ fontSize: 10 }}
            />
            <div className="grid grid-cols-2 gap-1">
              <SiteSelect
                value={rule.matchOp}
                onChange={(e) => updateRule(i, { matchOp: e.target.value as RouteActionMatchOp })}
                className={selectCls}
                style={{ fontSize: 10 }}
              >
                {ACTION_MATCH_OPS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </SiteSelect>
              <input
                value={rule.threshold ?? ''}
                onChange={(e) => updateRule(i, { threshold: e.target.value })}
                className={inputCls}
                placeholder={t('dashboard.properties.widgets.vehicleContainer.thresholdPlaceholder')}
                style={{ fontSize: 10 }}
                disabled={rule.matchOp === 'present'}
              />
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
