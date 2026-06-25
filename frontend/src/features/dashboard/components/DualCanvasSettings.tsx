import type { CanvasElementProps, DualCanvasGateOperator, WidgetDataBinding } from '../types';
import { WidgetDataBindingSettings } from '../elements/WidgetDataBindingSettings';

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

const OPS: { value: DualCanvasGateOperator; label: string }[] = [
  { value: 'gte', label: '≥ 大於等於' },
  { value: 'gt', label: '> 大於' },
  { value: 'lte', label: '≤ 小於等於' },
  { value: 'lt', label: '< 小於' },
  { value: 'eq', label: '= 等於' },
  { value: 'neq', label: '≠ 不等於' },
  { value: 'not_empty', label: '有資料（列數 > 0）' },
  { value: 'empty', label: '無資料（列數 = 0）' },
];

export function DualCanvasSettings({
  el,
  onUpdate,
}: {
  el: CanvasElementProps;
  onUpdate: (patch: Partial<CanvasElementProps>) => void;
}) {
  const gate = el.displayGate ?? { signal: 'rowCount', operator: 'gte', compareValue: '1' };
  const indexVar = el.variableName || 'item';

  const patchGate = (p: Partial<typeof gate>) =>
    onUpdate({ displayGate: { ...gate, ...p } });

  return (
    <div className="space-y-4">
      <div className="p-2.5 rounded-lg bg-purple-950/30 border border-purple-700/40 text-[10px] text-purple-200/90 leading-relaxed">
        雙畫板模式：左側編輯<strong className="text-purple-100">預設資料</strong>、右側編輯
        <strong className="text-purple-100">常態資料</strong>。執行時依閘道條件二選一顯示（互斥、不疊加）。
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
        啟用雙畫板（預設／常態）
      </label>

      <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
        <input
          type="checkbox"
          checked={el.defaultPanelEnabled !== false}
          onChange={e => onUpdate({ defaultPanelEnabled: e.target.checked })}
          className="accent-cyan-500 w-3.5 h-3.5"
        />
        啟用預設畫板（關閉時僅顯示常態畫板）
      </label>

      <div className="pt-2 border-t border-zinc-800 space-y-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">顯示閘道</div>
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          未另設閘道 SQL 時，沿用群組列表查詢結果。信號可為列數
          <code className="mx-0.5 text-zinc-400">rowCount</code>
          或首列欄位名（依你的 SQL 欄位命名，與群組索引變數
          <code className="mx-0.5 text-purple-300">{`{${indexVar}}`}</code>
          無關）。
        </p>

        <Field label="閘道 SQL（可選，覆寫群組列表查詢）">
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
          <Field label="信號">
            <input
              value={gate.signal ?? 'rowCount'}
              onChange={e => patchGate({ signal: e.target.value })}
              className={inputCls}
              placeholder="rowCount 或欄位名"
            />
          </Field>
          <Field label="運算">
            <select
              value={gate.operator ?? 'gte'}
              onChange={e => patchGate({ operator: e.target.value as DualCanvasGateOperator })}
              className={selectCls}
            >
              {OPS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="比較值">
            <input
              value={gate.compareValue ?? '1'}
              onChange={e => patchGate({ compareValue: e.target.value })}
              className={inputCls}
              placeholder="1"
            />
          </Field>
        </div>
        <p className="text-[10px] text-zinc-600">
          條件成立 → 常態畫板；不成立 → 預設畫板（若已啟用）。
        </p>
      </div>
    </div>
  );
}
