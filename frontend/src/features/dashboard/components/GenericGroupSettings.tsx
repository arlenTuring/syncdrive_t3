import { useState } from 'react';
import { Plus, Trash2, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import type {
  CanvasElementProps,
  GenericGroupConfig,
  GroupConditionOperator,
  GroupDataSource,
  GroupFieldCondition,
  GroupPriorityRule,
  GroupTemplateCondition,
  GroupTemplateDef,
  GroupValidityRule,
  FreshnessPolicy,
} from '../types';
import { createGroupTemplate, duplicateGroupTemplate } from '../utils/groupTemplateEdit';
import { DataSourceIdSelect } from '../elements/DataSourceIdSelect';

/**
 * 泛用群組的設定介面：資料來源、有效性、優先程度、排序、樣板、容量、轉場。
 * 都是表單操作，不需要使用者寫 JavaScript；規則存成結構化資料，不用 eval。
 *
 * 跟既有 `DualCanvasSettings.tsx` 同一個掛載慣例：`{el, onUpdate}`，掛在
 * `PropertiesPanel.tsx` 的 `CanvasSettings`（`el.isGroup` 區塊）裡。
 */

const inputCls = `w-full bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1 text-zinc-200 text-[11px]
  focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 transition-colors`;
const selectCls = `w-full bg-zinc-800 border border-zinc-700 rounded-md px-1.5 py-1 text-zinc-200 text-[11px]
  focus:outline-none focus:border-purple-500 transition-colors cursor-pointer`;
const smallBtn = `flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-colors`;

const OPERATORS: GroupConditionOperator[] = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains', 'empty', 'not_empty', 'before_now', 'after_now',
];
const OPERATOR_LABEL: Record<GroupConditionOperator, string> = {
  eq: '等於', neq: '不等於', gt: '大於', gte: '大於等於', lt: '小於', lte: '小於等於',
  contains: '包含', not_contains: '不包含', empty: '為空', not_empty: '不為空',
  before_now: '早於現在', after_now: '晚於現在',
};
const NO_VALUE_OPS = new Set<GroupConditionOperator>(['empty', 'not_empty', 'before_now', 'after_now']);

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="pt-3 border-t border-zinc-800 space-y-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400">{title}</div>
      {hint && <p className="text-[10px] text-zinc-500 leading-relaxed">{hint}</p>}
      {children}
    </div>
  );
}

function ConditionRow({
  condition, onChange, onRemove,
}: {
  condition: GroupFieldCondition;
  onChange: (c: GroupFieldCondition) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        value={condition.field}
        onChange={e => onChange({ ...condition, field: e.target.value })}
        placeholder="欄位"
        className={`${inputCls} flex-[1.2]`}
      />
      <select
        value={condition.operator}
        onChange={e => onChange({ ...condition, operator: e.target.value as GroupConditionOperator })}
        className={`${selectCls} flex-1`}
      >
        {OPERATORS.map(op => <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>)}
      </select>
      {!NO_VALUE_OPS.has(condition.operator) && (
        <input
          value={condition.value ?? ''}
          onChange={e => onChange({ ...condition, value: e.target.value })}
          placeholder="值"
          className={`${inputCls} flex-1`}
        />
      )}
      <button type="button" onClick={onRemove} className="p-1 text-zinc-600 hover:text-red-400">
        <Trash2 size={12} />
      </button>
    </div>
  );
}

// ─── 資料來源 ────────────────────────────────────────────────────────────────

function SourceEditor({
  source, onUpdate, onRemove,
}: {
  source: GroupDataSource;
  onUpdate: (p: Partial<GroupDataSource>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-zinc-700/60 bg-zinc-800/40 p-2 space-y-2">
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => setOpen(v => !v)} className="text-zinc-500">
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        <input
          value={source.label ?? source.id}
          onChange={e => onUpdate({ label: e.target.value })}
          placeholder={source.id}
          className={`${inputCls} flex-1 font-bold`}
        />
        <span className="text-[9px] text-zinc-600 font-mono">{source.id}</span>
        <button type="button" onClick={onRemove} className="p-1 text-zinc-600 hover:text-red-400">
          <Trash2 size={12} />
        </button>
      </div>
      {open && (
        <div className="space-y-2 pl-4">
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <DataSourceIdSelect
                value={source.dataSourceId ?? ''}
                onChange={v => onUpdate({ dataSourceId: v })}
                kind="sql"
              />
            </div>
            <div>
              <label className="block text-[9px] text-zinc-500 mb-0.5">更新策略</label>
              <select
                value={source.freshnessPolicy ?? 'auto'}
                onChange={e => onUpdate({ freshnessPolicy: e.target.value as FreshnessPolicy })}
                className={selectCls}
              >
                <option value="auto">自動</option>
                <option value="live">即時（MQTT）</option>
                <option value="on_change">有變更就更新</option>
                <option value="interval">定時輪詢</option>
                <option value="once">僅載入一次</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[9px] text-zinc-500 mb-0.5">SQL 查詢</label>
            <textarea
              value={source.sqlQuery ?? ''}
              onChange={e => onUpdate({ sqlQuery: e.target.value })}
              rows={3}
              className={`${inputCls} font-mono resize-y`}
              placeholder="SELECT ..."
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="block text-[9px] text-zinc-500 mb-0.5">項目識別欄位</label>
              <input value={source.itemIdField ?? ''} onChange={e => onUpdate({ itemIdField: e.target.value })} placeholder="order_id" className={inputCls} />
            </div>
            <div>
              <label className="block text-[9px] text-zinc-500 mb-0.5">內容版本欄位</label>
              <input value={source.contentVersionField ?? ''} onChange={e => onUpdate({ contentVersionField: e.target.value })} placeholder="updated_at" className={inputCls} />
            </div>
            <div>
              <label className="block text-[9px] text-zinc-500 mb-0.5">有效開始欄位</label>
              <input value={source.validStartField ?? ''} onChange={e => onUpdate({ validStartField: e.target.value })} placeholder="（可留空）" className={inputCls} />
            </div>
            <div>
              <label className="block text-[9px] text-zinc-500 mb-0.5">有效結束欄位</label>
              <input value={source.validEndField ?? ''} onChange={e => onUpdate({ validEndField: e.target.value })} placeholder="（可留空，不自動判斷結束）" className={inputCls} />
            </div>
            <div>
              <label className="block text-[9px] text-zinc-500 mb-0.5">失效狀態欄位</label>
              <input value={source.invalidStatusField ?? ''} onChange={e => onUpdate({ invalidStatusField: e.target.value })} placeholder="status" className={inputCls} />
            </div>
            <div>
              <label className="block text-[9px] text-zinc-500 mb-0.5">失效狀態值（逗號分隔）</label>
              <input
                value={(source.invalidStatusValues ?? []).join(',')}
                onChange={e => onUpdate({ invalidStatusValues: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder="CANCELLED,ENDED"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-[9px] text-zinc-500 mb-0.5">預設優先程度</label>
              <input
                type="number"
                value={source.defaultPriority ?? 0}
                onChange={e => onUpdate({ defaultPriority: Number(e.target.value) || 0 })}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className="block text-[9px] text-zinc-500 mb-0.5">欄位別名（來源欄位=樣板欄位，逗號分隔多組）</label>
            <input
              value={Object.entries(source.fieldAliases ?? {}).map(([k, v]) => `${k}=${v}`).join(',')}
              onChange={e => {
                const aliases: Record<string, string> = {};
                for (const pair of e.target.value.split(',')) {
                  const [k, v] = pair.split('=').map(s => s.trim());
                  if (k && v) aliases[k] = v;
                }
                onUpdate({ fieldAliases: aliases });
              }}
              placeholder="order_id=item_id"
              className={`${inputCls} font-mono`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 優先程度規則 ────────────────────────────────────────────────────────────

function PriorityRuleRow({
  rule, sourceIds, onUpdate, onRemove, onMove,
}: {
  rule: GroupPriorityRule;
  sourceIds: string[];
  onUpdate: (p: Partial<GroupPriorityRule>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const conditions = rule.conditions ?? [];
  return (
    <div className="rounded-lg border border-zinc-700/60 bg-zinc-800/40 p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <GripVertical size={11} className="text-zinc-600" />
        <input
          value={rule.label ?? ''}
          onChange={e => onUpdate({ label: e.target.value })}
          placeholder="規則名稱"
          className={`${inputCls} flex-1`}
        />
        <select
          value={rule.sourceId ?? ''}
          onChange={e => onUpdate({ sourceId: e.target.value || undefined })}
          className={`${selectCls} w-24`}
        >
          <option value="">全部來源</option>
          {sourceIds.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
        <label className="text-[9px] text-zinc-500">優先值</label>
        <input
          type="number"
          value={rule.priority}
          onChange={e => onUpdate({ priority: Number(e.target.value) || 0 })}
          className={`${inputCls} w-16`}
        />
        <button type="button" onClick={() => onMove(-1)} className="p-0.5 text-zinc-600 hover:text-zinc-300"><ChevronUp size={12} /></button>
        <button type="button" onClick={() => onMove(1)} className="p-0.5 text-zinc-600 hover:text-zinc-300"><ChevronDown size={12} /></button>
        <button type="button" onClick={onRemove} className="p-1 text-zinc-600 hover:text-red-400"><Trash2 size={12} /></button>
      </div>
      <div className="space-y-1 pl-4">
        {conditions.map((c, i) => (
          <ConditionRow
            key={i}
            condition={c}
            onChange={next => onUpdate({ conditions: conditions.map((cc, ii) => ii === i ? next : cc) })}
            onRemove={() => onUpdate({ conditions: conditions.filter((_, ii) => ii !== i) })}
          />
        ))}
        <button
          type="button"
          onClick={() => onUpdate({ conditions: [...conditions, { field: '', operator: 'eq', value: '' }] })}
          className={`${smallBtn} text-purple-400 hover:text-purple-300`}
        >
          <Plus size={11} /> 加條件（符合全部才命中）
        </button>
      </div>
    </div>
  );
}

// ─── 樣板清單 ────────────────────────────────────────────────────────────────

function TemplateRow({
  tpl, onUpdate, onRemove, onDuplicate, onSetDefault,
}: {
  tpl: GroupTemplateDef;
  onUpdate: (p: Partial<GroupTemplateDef>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onSetDefault: () => void;
}) {
  const conditions = tpl.conditions ?? [];
  return (
    <div className="rounded-lg border border-zinc-700/60 bg-zinc-800/40 p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input value={tpl.name} onChange={e => onUpdate({ name: e.target.value })} className={`${inputCls} flex-1 font-bold`} />
        <label className="flex items-center gap-1 text-[9px] text-zinc-500 whitespace-nowrap">
          <input type="radio" checked={!!tpl.isDefault} onChange={onSetDefault} className="accent-purple-500" />
          預設
        </label>
        <button type="button" onClick={onDuplicate} className="p-1 text-zinc-500 hover:text-zinc-300" title="複製">
          <Plus size={12} />
        </button>
        <button type="button" onClick={onRemove} className="p-1 text-zinc-600 hover:text-red-400"><Trash2 size={12} /></button>
      </div>
      <div className="space-y-1 pl-4">
        <div className="text-[9px] text-zinc-500">符合以下條件時使用（都沒設定就當預設）：</div>
        {conditions.map((c, i) => (
          <ConditionRow
            key={i}
            condition={c as GroupTemplateCondition}
            onChange={next => onUpdate({ conditions: conditions.map((cc, ii) => ii === i ? next : cc) })}
            onRemove={() => onUpdate({ conditions: conditions.filter((_, ii) => ii !== i) })}
          />
        ))}
        <button
          type="button"
          onClick={() => onUpdate({ conditions: [...conditions, { field: '', operator: 'eq', value: '' }] })}
          className={`${smallBtn} text-purple-400 hover:text-purple-300`}
        >
          <Plus size={11} /> 加條件
        </button>
      </div>
    </div>
  );
}

// ─── 主元件 ──────────────────────────────────────────────────────────────────

export function GenericGroupSettings({
  el, onUpdate,
}: {
  el: CanvasElementProps;
  onUpdate: (p: Partial<CanvasElementProps>) => void;
}) {
  const config: GenericGroupConfig = el.genericGroup ?? {};
  const enabled = !!config.enabled;

  const patch = (p: Partial<GenericGroupConfig>) => onUpdate({ genericGroup: { ...config, ...p } });

  const sources = config.sources ?? [];
  const priorityRules = config.priorityRules ?? [];
  const validityRules = config.validityRules ?? [];
  const sortRules = config.sortRules ?? [];
  const templates = config.templates ?? [];
  const capacity = config.capacityConfig ?? { capacity: el.slotCount ?? 6 };
  const transition = config.transitionConfig ?? { type: 'flip-up' };

  return (
    <div className="pt-3 border-t border-purple-500/20 space-y-2">
      <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => patch({ enabled: e.target.checked })}
          className="accent-purple-500 w-3.5 h-3.5"
        />
        <span className="font-bold">啟用泛用群組（多來源／優先程度／多樣板）</span>
      </label>
      <p className="text-[10px] text-zinc-500 leading-relaxed">
        關閉時群組維持原本行為（單一資料來源＋單一樣板）。開啟後下面的資料來源清單取代上方的單一資料綁定，樣板清單取代單一子畫布範本。
      </p>

      {enabled && (
        <>
          <Section title={`資料來源（${sources.length}）`} hint="每個來源各自管連線、載入、失敗與更新時間；查詢失敗不會清空其他來源的資料。">
            {sources.map((s, i) => (
              <SourceEditor
                key={s.id}
                source={s}
                onUpdate={p => patch({ sources: sources.map((ss, ii) => ii === i ? { ...ss, ...p } : ss) })}
                onRemove={() => patch({ sources: sources.filter((_, ii) => ii !== i) })}
              />
            ))}
            <button
              type="button"
              onClick={() => patch({ sources: [...sources, { id: `source-${Date.now()}`, label: '新來源' }] })}
              className={`${smallBtn} w-full justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-1.5`}
            >
              <Plus size={12} /> 新增資料來源
            </button>
          </Section>

          <Section title="項目識別" hint="不同來源預設不互相覆蓋（唯一鍵＝來源＋項目 ID）。只有明確設定合併欄位才會跨來源合併成同一筆。">
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="block text-[9px] text-zinc-500 mb-0.5">群組預設識別欄位</label>
                <input value={config.itemIdField ?? ''} onChange={e => patch({ itemIdField: e.target.value })} placeholder="id" className={inputCls} />
              </div>
              <div>
                <label className="block text-[9px] text-zinc-500 mb-0.5">跨來源合併欄位（選填）</label>
                <input value={config.mergeIdField ?? ''} onChange={e => patch({ mergeIdField: e.target.value || undefined })} placeholder="vehicle_code" className={inputCls} />
              </div>
            </div>
          </Section>

          <Section title={`有效性規則（${validityRules.length}）`} hint="命中即視為失效（可切換成「視為有效」白名單規則）。計畫結束時間到了不會自動失效，除非在這裡設規則。">
            {validityRules.map((r, i) => (
              <div key={r.id} className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/40 p-1.5">
                <select
                  value={r.effect ?? 'invalid'}
                  onChange={e => patch({ validityRules: validityRules.map((rr, ii) => ii === i ? { ...rr, effect: e.target.value as 'invalid' | 'valid' } : rr) })}
                  className={`${selectCls} w-20`}
                >
                  <option value="invalid">命中→失效</option>
                  <option value="valid">命中→有效</option>
                </select>
                <ConditionRow
                  condition={r}
                  onChange={next => patch({ validityRules: validityRules.map((rr, ii) => ii === i ? { ...rr, ...next } as GroupValidityRule : rr) })}
                  onRemove={() => patch({ validityRules: validityRules.filter((_, ii) => ii !== i) })}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => patch({ validityRules: [...validityRules, { id: `vr-${Date.now()}`, field: '', operator: 'eq', value: '', effect: 'invalid' }] })}
              className={`${smallBtn} w-full justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-1.5`}
            >
              <Plus size={12} /> 新增有效性規則
            </button>
          </Section>

          <Section title={`優先程度規則（${priorityRules.length}）`} hint="由上而下第一條命中的規則決定；都沒命中用來源或群組的預設優先程度。">
            {priorityRules.map((r, i) => (
              <PriorityRuleRow
                key={r.id}
                rule={r}
                sourceIds={sources.map(s => s.id)}
                onUpdate={p => patch({ priorityRules: priorityRules.map((rr, ii) => ii === i ? { ...rr, ...p } : rr) })}
                onRemove={() => patch({ priorityRules: priorityRules.filter((_, ii) => ii !== i) })}
                onMove={dir => {
                  const j = i + dir;
                  if (j < 0 || j >= priorityRules.length) return;
                  const next = [...priorityRules];
                  [next[i], next[j]] = [next[j], next[i]];
                  patch({ priorityRules: next });
                }}
              />
            ))}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => patch({ priorityRules: [...priorityRules, { id: `pr-${Date.now()}`, priority: 0, conditions: [] }] })}
                className={`${smallBtn} justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-1.5`}
              >
                <Plus size={12} /> 新增優先程度規則
              </button>
              <div>
                <label className="block text-[9px] text-zinc-500 mb-0.5">沒有規則命中時的預設優先程度</label>
                <input type="number" value={config.defaultPriority ?? 0} onChange={e => patch({ defaultPriority: Number(e.target.value) || 0 })} className={inputCls} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-[10px] text-zinc-400 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={!!config.preemptEqualPriority}
                onChange={e => patch({ preemptEqualPriority: e.target.checked })}
                className="accent-purple-500 w-3 h-3"
              />
              同優先程度時，較新的項目可以搶占（預設關閉，避免畫面抖動）
            </label>
          </Section>

          <Section title="同優先次排序">
            <div className="grid grid-cols-2 gap-1.5">
              <input
                value={sortRules[0]?.field ?? ''}
                onChange={e => patch({ sortRules: [{ field: e.target.value, direction: sortRules[0]?.direction ?? 'asc' }] })}
                placeholder="欄位（如 depart_at）"
                className={inputCls}
              />
              <select
                value={sortRules[0]?.direction ?? 'asc'}
                onChange={e => patch({ sortRules: [{ field: sortRules[0]?.field ?? '', direction: e.target.value as 'asc' | 'desc' }] })}
                className={selectCls}
              >
                <option value="asc">升冪</option>
                <option value="desc">降冪</option>
              </select>
            </div>
          </Section>

          <Section
            title={`樣板（${templates.length}）`}
            hint="每套樣板是獨立的子元件樹，用既有拖拉編輯器設計；依條件自動選用，符合條件的第一套優先，都沒命中用「預設」那一套。要編輯內容請按上方「編輯子畫布範本」進入，進去後可在工具列切換要編輯哪一套。"
          >
            {templates.map((tpl, i) => (
              <TemplateRow
                key={tpl.id}
                tpl={tpl}
                onUpdate={p => patch({ templates: templates.map((tt, ii) => ii === i ? { ...tt, ...p } : tt) })}
                onRemove={() => {
                  if (templates.length <= 1) return;
                  patch({ templates: templates.filter((_, ii) => ii !== i) });
                }}
                onDuplicate={() => patch({ templates: [...templates, duplicateGroupTemplate(tpl)] })}
                onSetDefault={() => patch({ templates: templates.map((tt, ii) => ({ ...tt, isDefault: ii === i })) })}
              />
            ))}
            <button
              type="button"
              onClick={() => {
                const created = createGroupTemplate(`樣板 ${templates.length + 1}`);
                patch({ templates: [...templates, { ...created, isDefault: templates.length === 0 }] });
              }}
              className={`${smallBtn} w-full justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-1.5`}
            >
              <Plus size={12} /> 新增樣板
            </button>
          </Section>

          <Section title="容量與溢出">
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="block text-[9px] text-zinc-500 mb-0.5">可見容量（格數）</label>
                <input
                  type="number"
                  min={1}
                  value={capacity.capacity}
                  onChange={e => patch({ capacityConfig: { ...capacity, capacity: Math.max(1, Number(e.target.value) || 1) } })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[9px] text-zinc-500 mb-0.5">資料不足時</label>
                <select
                  value={capacity.overflowFill ?? 'blank'}
                  onChange={e => patch({ capacityConfig: { ...capacity, overflowFill: e.target.value as 'stretch' | 'blank' } })}
                  className={selectCls}
                >
                  <option value="blank">保留空格</option>
                  <option value="stretch">撐滿畫面</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-[10px] text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={!!capacity.showPendingCount}
                onChange={e => patch({ capacityConfig: { ...capacity, showPendingCount: e.target.checked } })}
                className="accent-purple-500 w-3 h-3"
              />
              顯示「還有 N 筆未顯示」提示
            </label>
          </Section>

          <Section title="換頁效果">
            <div className="grid grid-cols-2 gap-1.5">
              <select
                value={transition.type ?? 'flip-up'}
                onChange={e => patch({ transitionConfig: { ...transition, type: e.target.value as 'none' | 'fade' | 'flip-up' } })}
                className={selectCls}
              >
                <option value="flip-up">向上翻頁</option>
                <option value="fade">淡入位移</option>
                <option value="none">無動畫</option>
              </select>
              <div>
                <label className="block text-[9px] text-zinc-500 mb-0.5">時間（毫秒，選填）</label>
                <input
                  type="number"
                  value={transition.durationMs ?? ''}
                  onChange={e => patch({ transitionConfig: { ...transition, durationMs: e.target.value ? Number(e.target.value) : undefined } })}
                  placeholder="380"
                  className={inputCls}
                />
              </div>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
