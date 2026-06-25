import React from 'react';
import { useBindingHealth } from './context/BindingHealthContext';
import type { 
  DashboardPlane, CanvasElementProps, ChildWidget, TextWidget, ImageWidget, 
  LineChartWidget, LineChartSeriesConfig, LineChartEventLabelStyle, ChartAxisBandConfig, ChartAxisBandColorRule, ChartAxisConfig, ChartAxisUnit, ChartViewportMode, DatabaseWidget, GaugeWidget, SlotGridWidget, ColorRule, WidgetDataBinding,
  ColorBlockWidget, StatusBadgeWidget, StatusBadgeRule,
  StatCardWidget, ProgressBarWidget, ClockWidget, EmptyStateWidget, SegmentBarWidget, SegmentBarColorRule, BarChartWidget, MapCanvasWidget,
  AlertBannerWidget, AlertRule, AlertTriggerMode, AlertDisplayMode,
  UnitTelemetryCardWidget,
  VehicleContainerWidget,
  RouteActionIconRule,
  RouteActionMatchOp,
} from './types';
import {
  buildVehicleBehaviorActionRules,
  VEHICLE_BEHAVIOR_ACTION_CATALOG,
} from '../vehicle-editor/constants/behaviorActionCatalog';
import { WidgetDataBindingSettings } from './elements/WidgetDataBindingSettings';
import { createEmptyAlertRule, coerceAlertRule, getEditorAlertRules } from './utils/alertTrigger';
import { resolveFreshness, FRESHNESS_POLICY_OPTIONS } from './utils/resolveFreshness';
import type { FreshnessPolicy } from './types';
import { newSeriesId, resolveLineChartSeries, syncSeriesToLegacyFields } from './elements/lineChartSeries';
import * as LucideIcons from 'lucide-react';
import { 
  Layers, Trash2, Settings, Type, Image, TrendingUp, Database, 
  Gauge, LayoutGrid, Plus, X, Palette,
  Square, Tag, Hash, AlignJustify, Clock, BarChart2, Map, AlertTriangle, CircleOff, Monitor, Bus, Zap
} from 'lucide-react';
import { DataSourcePicker } from './elements/DataSourcePicker';
import { DataSourceIdSelect } from './elements/DataSourceIdSelect';
import { getAvailableMaps } from './elements/mapCanvasStorage';
import { RouteProgressSettings } from './route-progress/RouteProgressSettings';
import { TextAlignmentControls } from '../../components/TextAlignmentControls';
import {
  resolveTextHorizontalAlign,
  resolveTextVerticalAlign,
} from '../../lib/textAlignment';
import { IconImageField } from './components/IconImageField';
import { DualCanvasSettings } from './components/DualCanvasSettings';
// ─── 共用 UI ────────────────────────────────────────────────────────

const inputCls = `w-full bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-zinc-200 text-xs
  focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 transition-colors`;

const selectCls = `w-full bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1.5 text-zinc-200 text-xs
  focus:outline-none focus:border-cyan-500 transition-colors cursor-pointer`;

function SH({ icon, label, color }: { icon: React.ReactNode; label: string; color?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider pb-1 border-b border-zinc-800"
         style={{ color: color ?? '#71717a' }}>
      {icon} {label}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="block text-zinc-500 text-[10px] uppercase font-bold tracking-tight">{label}</label>{children}</div>;
}
function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }

function GroupInheritedVariablesSection({
  group,
  onInsertToken,
}: {
  group: CanvasElementProps;
  onInsertToken?: (token: string) => void;
}) {
  const rowVar = group.variableName || 'item';
  const indexMode = (group.groupVariableMode ?? 'row') === 'index';
  const hasListSql = !!(group.dataSourceId && group.sqlQuery?.trim());

  return (
    <div className="mb-4 p-3 rounded-lg bg-purple-950/25 border border-purple-700/40 space-y-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-purple-300">群組繼承變數</div>
      {indexMode ? (
        <p className="text-[10px] text-zinc-400 leading-relaxed">
          群組僅注入<strong className="text-zinc-300 font-medium">列索引</strong>
          <code className="mx-1 text-purple-300 font-mono">{`{${rowVar}}`}</code>
          （0, 1, 2…）。各元件請在 SQL／MQTT 綁定中用此變數取第 N 筆，例如
          <code className="block mt-1 text-[9px] text-zinc-500 font-mono leading-relaxed">
            LIMIT 1 OFFSET {'{'}{rowVar}{'}'}
          </code>
        </p>
      ) : (
        <p className="text-[10px] text-zinc-400 leading-relaxed">
          群組注入整列欄位；文字可用 <code className="text-purple-300 font-mono">{'{欄位名}'}</code> 引用。
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <code className="px-2 py-1 rounded bg-purple-500/20 border border-purple-500/35 text-purple-200 text-[11px] font-mono">
          {`{${rowVar}}`}
        </code>
        {onInsertToken && (
          <button
            type="button"
            onClick={() => onInsertToken(`{${rowVar}}`)}
            className="text-[10px] text-cyan-400 hover:text-cyan-300"
          >
            插入至查詢
          </button>
        )}
      </div>
      {hasListSql && indexMode && (
        <p className="text-[10px] text-zinc-500">
          群組 SQL 僅決定列數與輪播；欄位內容請在子元件各自綁定。
        </p>
      )}
    </div>
  );
}

// ─── 資料綁定元件 ────────────────────────────────────────────────────

function DataBindingSettings({ 
  w, onUpdate 
}: { 
  w: WidgetDataBinding; 
  onUpdate: (p: Partial<WidgetDataBinding>) => void 
}) {
  const [mode, setMode] = React.useState<'sql' | 'mqtt' | 'rest'>(
    w.mqttDataSourceId ? 'mqtt' : (w.dataUrl ? 'rest' : 'sql')
  );

  // T2-C 修正：當選取的 Widget 改變時（例如從 MQTT Widget 切換到 SQL Widget），
  // 同步更新 mode 狀態，防止頁籤顯示錯誤的資料綁定模式
  React.useEffect(() => {
    setMode(w.mqttDataSourceId ? 'mqtt' : (w.dataUrl ? 'rest' : 'sql'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.dataSourceId, w.mqttDataSourceId, w.dataUrl]);

  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-3 bg-zinc-900/50">
      <div className="flex gap-1 bg-zinc-800 p-0.5 rounded-md">
        {(['sql', 'mqtt', 'rest'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`flex-1 py-1 text-[10px] font-bold rounded uppercase transition-all
              ${mode === m ? 'bg-cyan-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {m}
          </button>
        ))}
      </div>

      {mode === 'sql' && (
        <DataSourcePicker
          dataSourceId={w.dataSourceId ?? ''}
          sqlQuery={w.sqlQuery ?? ''}
          onChangeDataSource={id => onUpdate({ dataSourceId: id, mqttDataSourceId: '', dataUrl: '' })}
          onChangeSqlQuery={q => onUpdate({ sqlQuery: q })}
        />
      )}

      {mode === 'mqtt' && (
        <div className="space-y-2">
          <DataSourceIdSelect
            kind="mqtt"
            value={w.mqttDataSourceId ?? ''}
            onChange={id => onUpdate({ mqttDataSourceId: id, dataSourceId: '', dataUrl: '' })}
          />
          <Field label="訂閱主題 (Topic)">
            <input value={w.mqttTopic} onChange={e => onUpdate({ mqttTopic: e.target.value })} 
                   className={inputCls} placeholder="v1/vtms/+/telemetry/update" />
          </Field>
          <Field label="數值路徑 (JSON Path)">
            <input value={w.mqttValuePath} onChange={e => onUpdate({ mqttValuePath: e.target.value })} 
                   className={inputCls} placeholder="payload.speed" />
          </Field>
        </div>
      )}

      {mode === 'rest' && (
        <Field label="直接 REST URL">
          <input value={w.dataUrl} onChange={e => onUpdate({ dataUrl: e.target.value, dataSourceId: '', mqttDataSourceId: '' })} 
                 className={inputCls} placeholder="https://api.example.com/data" />
        </Field>
      )}

      <Field label="更新方式">
        <select
          value={w.freshnessPolicy ?? 'auto'}
          onChange={e => onUpdate({ freshnessPolicy: e.target.value as FreshnessPolicy })}
          className={inputCls}
        >
          {FRESHNESS_POLICY_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p className="text-zinc-500 text-[10px] leading-snug mt-1">
          {FRESHNESS_POLICY_OPTIONS.find(o => o.value === (w.freshnessPolicy ?? 'auto'))?.hint}
          <span className="block text-zinc-600 mt-0.5">目前由平台判定：{resolveFreshness(w).reason}</span>
        </p>
        {(w.freshnessPolicy ?? 'auto') === 'interval' && (
          <>
            <input type="number" min={1} value={w.refreshInterval || 15}
                   onChange={e => onUpdate({ refreshInterval: +e.target.value })}
                   className={`${inputCls} mt-1.5`} placeholder="每隔幾秒更新" />
            <p className="text-amber-500/80 text-[10px] leading-snug mt-1">
              ⚠ 定時輪詢會對資料庫造成重複查詢，僅建議用於無法即時推送的資料。
            </p>
          </>
        )}
      </Field>
    </div>
  );
}

function AlertRulesEditor({
  rules,
  onChange,
}: {
  rules: AlertRule[];
  onChange: (next: AlertRule[]) => void;
}) {
  const add = () => onChange([...rules, createEmptyAlertRule()]);
  const remove = (idx: number) => onChange(rules.filter((_, i) => i !== idx));
  const patch = (idx: number, p: Partial<AlertRule>) =>
    onChange(rules.map((r, i) => (i === idx ? { ...r, ...p } : r)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-zinc-500 text-[10px] uppercase font-bold tracking-tight">警示規則</label>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); add(); }}
          className="p-1 hover:bg-zinc-800 rounded text-cyan-500 transition-colors"
          title="新增規則"
        >
          <Plus size={14} />
        </button>
      </div>
      <p className="text-[10px] text-zinc-500 leading-relaxed">
        每條規則獨立設定文字、顏色、閃爍方式與起訖條件。<strong className="text-zinc-400">多條同時命中會多行顯示</strong>。
      </p>
      {rules.length === 0 && (
        <p className="text-[10px] text-amber-500/90">尚無規則，請按 + 新增。</p>
      )}
      {rules.map((rule, i) => (
        <div key={rule.id} className="p-2.5 bg-zinc-800/40 rounded-md border border-zinc-700/50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-400">規則 {i + 1}</span>
            <button type="button" onClick={() => remove(i)} className="p-0.5 text-zinc-500 hover:text-red-400 transition-colors">
              <X size={12} />
            </button>
          </div>

          <Field label="顯示文字（可含變數）">
            <textarea
              value={rule.content}
              onChange={e => patch(i, { content: e.target.value })}
              className={`${inputCls} h-12 resize-none`}
              placeholder="例如：感測器異常，請檢查 {vehicle_code}"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="文字顏色">
              <input type="color" value={rule.textColor} onChange={e => patch(i, { textColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" />
            </Field>
            <Field label="背景顏色">
              <input type="color" value={hexFromRgba(rule.backgroundColor)} onChange={e => patch(i, { backgroundColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" />
            </Field>
          </div>
          <Field label="邊框顏色">
            <input type="color" value={hexFromRgba(rule.borderColor)} onChange={e => patch(i, { borderColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" />
          </Field>
          <Field label="顯示方式">
            <select value={rule.displayMode} onChange={e => patch(i, { displayMode: e.target.value as AlertDisplayMode })} className={selectCls}>
              <option value="blink">閃爍（預設）</option>
              <option value="static">持續顯示</option>
            </select>
          </Field>

          <div className="pt-1 border-t border-zinc-700/50 space-y-2">
            <p className="text-[10px] font-bold text-emerald-500/90">開始條件（命中才顯示）</p>
            <Field label="監看欄位">
              <input value={rule.startField} onChange={e => patch(i, { startField: e.target.value })} className={inputCls} placeholder="alert_message" />
            </Field>
            <Field label="觸發模式">
              <select value={rule.startMode} onChange={e => patch(i, { startMode: e.target.value as AlertTriggerMode })} className={selectCls}>
                <option value="non-empty">有值</option>
                <option value="equals">等於</option>
                <option value="not-equals">不等於</option>
              </select>
            </Field>
            {(rule.startMode === 'equals' || rule.startMode === 'not-equals') && (
              <Field label="比對值">
                <input value={rule.startValue ?? ''} onChange={e => patch(i, { startValue: e.target.value })} className={inputCls} />
              </Field>
            )}
          </div>

          <div className="pt-1 border-t border-zinc-700/50 space-y-2">
            <label className="flex items-center gap-2 text-[10px] text-zinc-400">
              <input type="checkbox" checked={rule.endEnabled} onChange={e => patch(i, { endEnabled: e.target.checked })} className="accent-cyan-500" />
              啟用結束條件（命中則隱藏此列）
            </label>
            {rule.endEnabled && (
              <>
                <Field label="結束欄位">
                  <input value={rule.endField ?? ''} onChange={e => patch(i, { endField: e.target.value })} className={inputCls} placeholder="health_status" />
                </Field>
                <Field label="結束模式">
                  <select value={rule.endMode ?? 'non-empty'} onChange={e => patch(i, { endMode: e.target.value as AlertTriggerMode })} className={selectCls}>
                    <option value="non-empty">有值</option>
                    <option value="equals">等於</option>
                    <option value="not-equals">不等於</option>
                  </select>
                </Field>
                {(rule.endMode === 'equals' || rule.endMode === 'not-equals' || !rule.endMode) && (
                  <Field label="結束比對值">
                    <input value={rule.endValue ?? ''} onChange={e => patch(i, { endValue: e.target.value })} className={inputCls} placeholder="OK" />
                  </Field>
                )}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** color input 需 #rrggbb；rgba 先轉近似 hex */
function hexFromRgba(color: string): string {
  if (color.startsWith('#')) return color.slice(0, 7);
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#c2410c';
  const hex = (n: string) => Number(n).toString(16).padStart(2, '0');
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
}

// ─── 條件著色編輯器 ──────────────────────────────────────────────────

function ColorRulesEditor({ 
  rules = [], onUpdate, enabled, onToggleEnabled
}: { 
  rules?: ColorRule[]; 
  onUpdate: (rules: ColorRule[]) => void;
  enabled: boolean;
  onToggleEnabled: (e: boolean) => void;
}) {
  const addRule = () => onUpdate([...rules, { condition: 'gt', threshold: '0', textColor: '#ffffff', bgColor: '#ef4444', borderColor: '#ef4444' }]);
  const removeRule = (idx: number) => onUpdate(rules.filter((_, i) => i !== idx));
  const updateRule = (idx: number, patch: Partial<ColorRule>) => onUpdate(rules.map((r, i) => i === idx ? { ...r, ...patch } : r));

  return (
    <div className={`space-y-2 border-t border-zinc-800 pt-3 transition-opacity ${!enabled ? 'opacity-40' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={e => onToggleEnabled(e.target.checked)} className="accent-cyan-500 w-3 h-3 cursor-pointer" />
          <SH icon={<Palette size={12} />} label="條件著色規則" color="#ec4899" />
        </div>
        {enabled && (
          <button onClick={addRule} className="p-1 hover:bg-zinc-800 rounded text-cyan-500 transition-colors">
            <Plus size={14} />
          </button>
        )}
      </div>
      
      {enabled && rules.map((rule, i) => (
        <div key={i} className="p-2 bg-zinc-800/40 rounded-md border border-zinc-700/50 space-y-2 relative group">
          <button onClick={() => removeRule(i)} className="absolute -top-1.5 -right-1.5 p-0.5 bg-zinc-700 rounded-full text-zinc-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity">
            <X size={10} />
          </button>
          <div className="flex gap-1.5 items-center">
            <select value={rule.condition} onChange={e => updateRule(i, { condition: e.target.value as any })} className={`${selectCls} flex-1`}>
              <option value="gt">大於 &gt;</option><option value="lt">小於 &lt;</option>
              <option value="eq">等於 =</option><option value="contains">包含</option>
              <option value="status_eq">狀態等於 (字串)</option>
            </select>
            <input value={rule.threshold} onChange={e => updateRule(i, { threshold: e.target.value })} className={`${inputCls} flex-1`} placeholder="門檻值" />
          </div>
          <div className="grid grid-cols-3 gap-1">
            <div className="flex items-center gap-1 bg-zinc-900/50 p-1 rounded border border-zinc-700/30">
              <input type="color" value={rule.textColor} onChange={e => updateRule(i, { textColor: e.target.value })} className="w-3.5 h-3.5 bg-transparent cursor-pointer" />
              <span className="text-[8px] text-zinc-500 uppercase">字</span>
            </div>
            <div className="flex items-center gap-1 bg-zinc-900/50 p-1 rounded border border-zinc-700/30">
              <input type="color" value={rule.bgColor} onChange={e => updateRule(i, { bgColor: e.target.value })} className="w-3.5 h-3.5 bg-transparent cursor-pointer" />
              <span className="text-[8px] text-zinc-500 uppercase">背</span>
            </div>
            <div className="flex items-center gap-1 bg-zinc-900/50 p-1 rounded border border-zinc-700/30">
              <input type="color" value={rule.borderColor || '#ffffff'} onChange={e => updateRule(i, { borderColor: e.target.value })} className="w-3.5 h-3.5 bg-transparent cursor-pointer" />
              <span className="text-[8px] text-zinc-500 uppercase">框</span>
            </div>
          </div>
        </div>
      ))}
      {rules.length === 0 && <div className="text-[10px] text-zinc-600 text-center py-2 italic">尚未設定規則</div>}
    </div>
  );
}

// ─── 各元件設定畫面 ──────────────────────────────────────────────────

function TextSettings({
  w,
  onUpdate,
  onDelete,
  editingGroup,
}: {
  w: TextWidget;
  onUpdate: (p: Partial<TextWidget>) => void;
  onDelete: () => void;
  editingGroup?: CanvasElementProps | null;
}) {
  const commonIcons = ['Activity', 'AlertTriangle', 'Bell', 'Battery', 'Cpu', 'Database', 'Eye', 'Gauge', 'HardDrive', 'Home', 'Info', 'Layers', 'Lock', 'Power', 'Settings', 'Shield', 'Thermometer', 'Wifi'];

  const insertIntoSql = (token: string) => {
    const q = w.sqlQuery ?? '';
    onUpdate({ sqlQuery: q ? `${q}${q.endsWith(' ') ? '' : ' '}${token}` : token });
  };

  return (
    <div className="space-y-5">
      {editingGroup && (
        <GroupInheritedVariablesSection group={editingGroup} onInsertToken={insertIntoSql} />
      )}
      <SH icon={<Type size={13} />} label="文字屬性" color="#f59e0b" />
      
      <div className="space-y-3">
        <Field label="預設內容">
          <textarea
            value={w.content}
            onChange={e => onUpdate({ content: e.target.value })}
            className={`${inputCls} h-16 resize-none`}
            placeholder="可填占位文字，如：在這邊編輯文字"
          />
          {(w.dataSourceId || w.mqttDataSourceId) && (
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              已綁定 SQL／MQTT 時，編輯模式且尚無即時資料會顯示此文字；留空則依欄位名稱自動示範。
            </p>
          )}
        </Field>
        
        <Field label="圖示 (Icon)">
          <div className="space-y-2">
            <select value={w.icon || ''} onChange={e => onUpdate({ icon: e.target.value })} className={selectCls}>
              <option value="">（內建圖示）</option>
              {commonIcons.map(icon => <option key={icon} value={icon}>{icon}</option>)}
            </select>
            <div className="flex flex-wrap gap-1 mt-2">
              {commonIcons.slice(0, 8).map(icon => (
                <button key={icon} onClick={() => onUpdate({ icon })} 
                  className={`p-1.5 rounded bg-zinc-800 border transition-all ${w.icon === icon ? 'border-cyan-500 bg-cyan-500/10' : 'border-zinc-700 hover:border-zinc-500'}`}>
                  {React.createElement((LucideIcons as any)[icon] || Type, { size: 14, className: w.icon === icon ? 'text-cyan-400' : 'text-zinc-400' })}
                </button>
              ))}
            </div>
          </div>
        </Field>

        <Field label="圖片圖示">
          <IconImageField
            value={w.iconImage}
            onChange={(url) => onUpdate({ iconImage: url, icon: url ? undefined : w.icon })}
          />
        </Field>

        {(w.icon || w.iconImage) && (
          <Field label="圖示與文字間距 (px)">
            <input
              type="number"
              min={0}
              max={32}
              value={w.iconGap ?? (w.textWrap === 'nowrap' ? 4 : 8)}
              onChange={e => onUpdate({ iconGap: Math.max(0, +e.target.value) })}
              className={inputCls}
            />
          </Field>
        )}
      </div>

      <div className="space-y-4 pt-4 border-t border-zinc-800">
        <SH icon={<Palette size={13} />} label="預設外觀樣式" color="#ec4899" />
        
        <div className="grid grid-cols-2 gap-3">
          <Field label="文字顏色">
            <div className="flex gap-2">
              <input type="color" value={w.color.startsWith('#') ? w.color : '#ffffff'} onChange={e => onUpdate({ color: e.target.value })} className="w-8 h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" />
              <input value={w.color} onChange={e => onUpdate({ color: e.target.value })} className={`${inputCls} font-mono`} placeholder="#RRGGBB" />
            </div>
          </Field>
          <Field label="字體大小">
            <input type="number" value={w.fontSize} onChange={e => onUpdate({ fontSize: +e.target.value })} className={inputCls} />
          </Field>
        </div>

        <Field label="對齊">
          <TextAlignmentControls
            horizontal={resolveTextHorizontalAlign(w.textAlign)}
            vertical={resolveTextVerticalAlign(w.verticalAlign)}
            onHorizontalChange={(textAlign) => onUpdate({ textAlign })}
            onVerticalChange={(verticalAlign) => onUpdate({ verticalAlign })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="背景填滿 (Fill)">
            <div className="flex gap-2">
              <input type="color" value={w.backgroundColor?.startsWith('#') ? w.backgroundColor : '#000000'} onChange={e => onUpdate({ backgroundColor: e.target.value })} className="w-8 h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" />
              <button onClick={() => onUpdate({ backgroundColor: 'transparent' })} className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[9px] hover:bg-zinc-700 transition-colors">透明</button>
            </div>
          </Field>
          <Field label="圓角 (Radius)">
            <input type="number" min={0} value={w.borderRadius || 0} onChange={e => onUpdate({ borderRadius: +e.target.value })} className={inputCls} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="外框顏色">
            <div className="flex gap-2">
              <input type="color" value={w.borderColor?.startsWith('#') ? w.borderColor : '#ffffff'} onChange={e => onUpdate({ borderColor: e.target.value })} className="w-8 h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" />
              <button onClick={() => onUpdate({ borderColor: 'transparent' })} className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[9px] hover:bg-zinc-700 transition-colors">透明</button>
            </div>
          </Field>
          <Field label="外框粗細">
            <input type="number" min={0} value={w.borderWidth || 0} onChange={e => onUpdate({ borderWidth: +e.target.value })} className={inputCls} />
          </Field>
        </div>
      </div>

      <div className="pt-4 border-t border-zinc-800">
        <SH icon={<Database size={13} />} label="數據綁定" color="#a78bfa" />
        <div className="mt-3 space-y-3">
          <DataBindingSettings w={w} onUpdate={onUpdate} />
          <Field label="對應資料欄位名稱">
            <input value={w.valueField} onChange={e => onUpdate({ valueField: e.target.value })} className={inputCls} placeholder="battery_level" />
          </Field>
        </div>
      </div>

      <ColorRulesEditor 
        rules={w.colorRules} 
        enabled={w.colorRulesEnabled}
        onToggleEnabled={e => onUpdate({ colorRulesEnabled: e })}
        onUpdate={rules => onUpdate({ colorRules: rules })} 
      />
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <input type="checkbox" checked={!!w.severityTextColor}
          onChange={e => onUpdate({ severityTextColor: e.target.checked })} />
        依 severity 變更文字色（群組範本內有效）
      </label>
      <PositionFields widget={w} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function AlertBannerSettings({ w, onUpdate, onDelete }: { w: AlertBannerWidget; onUpdate: (p: Partial<AlertBannerWidget>) => void; onDelete: () => void }) {
  const rules = w.triggerConditions != null
    ? w.triggerConditions.map((r, i) => coerceAlertRule(r, i))
    : getEditorAlertRules(w);

  const setRules = (next: AlertRule[]) =>
    onUpdate({ triggerConditions: next, triggerField: undefined, triggerMode: undefined, triggerValue: undefined });

  return (
    <div className="space-y-5">
      <SH icon={<Database size={13} />} label="資料來源" color="#a78bfa" />
      <DataBindingSettings w={w} onUpdate={onUpdate} />

      <div className="pt-2 border-t border-zinc-800 space-y-3">
        <SH icon={<AlertTriangle size={13} />} label="警示規則" color="#f97316" />
        <div className="p-2.5 rounded-lg bg-amber-950/25 border border-amber-700/40 text-[10px] text-amber-200/90 leading-relaxed">
          預覽時僅顯示命中規則；編輯模式可預覽全部規則。
          {(w.alertPresentation ?? 'stack') === 'carousel'
            ? <> 多條命中時<strong>輪播</strong>（一次一條）。</>
            : <> 多條同時命中會<strong>多行並列</strong>顯示。</>}
        </div>
        <AlertRulesEditor rules={rules} onChange={setRules} />
      </div>

      <div className="pt-2 border-t border-zinc-800 space-y-3">
        <SH icon={<Type size={13} />} label="呈現方式" color="#38bdf8" />
        <Field label="多條命中時">
          <select
            value={w.alertPresentation ?? 'stack'}
            onChange={e => onUpdate({ alertPresentation: e.target.value as 'stack' | 'carousel' })}
            className={inputCls}
          >
            <option value="stack">多行並列</option>
            <option value="carousel">輪播（一次一條）</option>
          </select>
        </Field>
        {(w.alertPresentation ?? 'stack') === 'carousel' && (
          <Field label="輪播間隔 (ms)">
            <input
              type="number"
              min={1200}
              step={100}
              value={w.carouselIntervalMs ?? 3200}
              onChange={e => onUpdate({ carouselIntervalMs: +e.target.value })}
              className={inputCls}
            />
          </Field>
        )}
      </div>

      <div className="pt-2 border-t border-zinc-800 space-y-3">
        <SH icon={<Type size={13} />} label="共用樣式" color="#94a3b8" />
        <Field label="字級">
          <input type="number" min={8} value={w.fontSize ?? 10} onChange={e => onUpdate({ fontSize: +e.target.value })} className={inputCls} />
        </Field>
        <Field label="圖示 (Lucide，選填)">
          <input value={w.icon ?? ''} onChange={e => onUpdate({ icon: e.target.value })} className={inputCls} placeholder="AlertCircle" />
        </Field>
      </div>

      <PositionFields widget={w} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function GaugeSettings({ w, onUpdate, onDelete }: { w: GaugeWidget; onUpdate: (p: Partial<GaugeWidget>) => void; onDelete: () => void }) {
  return (
    <div className="space-y-4">
      <SH icon={<Gauge size={13} />} label="儀表板屬性" color="#ec4899" />
      <Field label="標題"><input value={w.title} onChange={e => onUpdate({ title: e.target.value })} className={inputCls} /></Field>
      
      <DataBindingSettings w={w} onUpdate={onUpdate} />
      <Field label="數值欄位名稱"><input value={w.valueField} onChange={e => onUpdate({ valueField: e.target.value })} className={inputCls} placeholder="speed" /></Field>
      
      <div className="grid grid-cols-3 gap-1.5">
        <Field label="最小值"><input type="number" value={w.min} onChange={e => onUpdate({ min: +e.target.value })} className={inputCls} /></Field>
        <Field label="最大值"><input type="number" value={w.max} onChange={e => onUpdate({ max: +e.target.value })} className={inputCls} /></Field>
        <Field label="單位"><input value={w.unit} onChange={e => onUpdate({ unit: e.target.value })} className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="顯示數值字級 (px)">
          <input
            type="number"
            min={8}
            max={96}
            value={w.gaugeValueFontSize ?? 16}
            onChange={e => onUpdate({ gaugeValueFontSize: +e.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label="單位字級 (px)">
          <input
            type="number"
            min={7}
            max={48}
            value={w.gaugeUnitFontSize ?? 12}
            onChange={e => onUpdate({ gaugeUnitFontSize: +e.target.value })}
            className={inputCls}
          />
        </Field>
      </div>
      <Field label="弧線寬度 (px)">
        <input
          type="number"
          min={1}
          max={32}
          value={w.gaugeArcStrokeWidth ?? ''}
          placeholder={w.gaugeVariant === 'semi-arc' ? '自動' : '12'}
          onChange={e => {
            const v = e.target.value.trim();
            onUpdate({ gaugeArcStrokeWidth: v === '' ? undefined : Math.max(1, +v) });
          }}
          className={inputCls}
        />
        <p className="text-[10px] text-zinc-500 mt-1 leading-relaxed">
          半圓儀表弧線粗細；留白則依元件尺寸自動計算。
        </p>
      </Field>
      <div className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">內距 (px)</div>
        <div className="grid grid-cols-4 gap-1.5">
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <Field key={side} label={side === 'top' ? '上' : side === 'right' ? '右' : side === 'bottom' ? '下' : '左'}>
              <input
                type="number"
                min={0}
                max={48}
                value={w.gaugeContentPadding?.[side] ?? ''}
                placeholder="0"
                onChange={e => {
                  const v = e.target.value.trim();
                  const next = { ...w.gaugeContentPadding };
                  if (v === '') delete next[side];
                  else next[side] = Math.max(0, +v);
                  const empty = (['top', 'right', 'bottom', 'left'] as const)
                    .every(k => next[k] === undefined);
                  onUpdate({ gaugeContentPadding: empty ? undefined : next });
                }}
                className={inputCls}
              />
            </Field>
          ))}
        </div>
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          弧線／數值與面板外框的距離；四邊皆留白則為 0。
        </p>
      </div>
      <Field label="文字與弧線間距 (px)">
        <input
          type="number"
          min={-24}
          max={48}
          value={w.gaugeTextGap ?? 0}
          onChange={e => onUpdate({ gaugeTextGap: +e.target.value })}
          className={inputCls}
        />
        <p className="text-[10px] text-zinc-500 mt-1 leading-relaxed">
          調整中央數值／單位與半圓弧線的垂直距離；正值下移、負值上移。
        </p>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="面板底色">
          <input
            type="color"
            value={w.panelBackgroundColor?.startsWith('#') ? w.panelBackgroundColor : '#1a2332'}
            onChange={e => onUpdate({ panelBackgroundColor: e.target.value })}
            className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer"
          />
        </Field>
        <Field label="面板圓角">
          <input
            type="number"
            min={0}
            value={w.panelBorderRadius ?? 6}
            onChange={e => onUpdate({ panelBorderRadius: +e.target.value })}
            className={inputCls}
          />
        </Field>
      </div>
      <button
        type="button"
        className="text-xs text-zinc-400 hover:text-zinc-200 underline"
        onClick={() => onUpdate({ panelBackgroundColor: 'transparent', panelBorderRadius: 0 })}
      >
        面板改為透明（改由色塊當底）
      </button>

      <PositionFields widget={w} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function SegmentBarSettings({ w, onUpdate, onDelete }: { w: SegmentBarWidget; onUpdate: (p: Partial<SegmentBarWidget>) => void; onDelete: () => void }) {
  const rules = w.colorRules ?? [];
  const patchRule = (idx: number, patch: Partial<SegmentBarColorRule>) => {
    const next = rules.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onUpdate({ colorRules: next });
  };
  return (
    <div className="space-y-4">
      <SH icon={<BarChart2 size={13} />} label="分段比例條" color="#22c55e" />
      <Field label="標題"><input value={w.title ?? ''} onChange={e => onUpdate({ title: e.target.value })} className={inputCls} /></Field>
      <Field label="標題圖示">
        <IconImageField
          value={w.titleIconImage}
          onChange={(url) => onUpdate({ titleIconImage: url })}
        />
      </Field>
      <DataBindingSettings w={w} onUpdate={onUpdate} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="狀態欄位"><input value={w.statusField} onChange={e => onUpdate({ statusField: e.target.value })} className={inputCls} placeholder="status_code" /></Field>
        <Field label="比例欄位"><input value={w.pctField} onChange={e => onUpdate({ pctField: e.target.value })} className={inputCls} placeholder="pct" /></Field>
        <Field label="數量欄位"><input value={w.countField} onChange={e => onUpdate({ countField: e.target.value })} className={inputCls} placeholder="vehicle_count" /></Field>
        <Field label="數量單位"><input value={w.countUnit ?? '輛'} onChange={e => onUpdate({ countUnit: e.target.value })} className={inputCls} /></Field>
      </div>
      <label className="flex items-center gap-2 text-[10px] text-zinc-400">
        <input type="checkbox" checked={w.showLegend !== false} onChange={e => onUpdate({ showLegend: e.target.checked })} />
        顯示圖例
      </label>
      <p className="text-[10px] text-zinc-500">狀態色對照表（元件內建，不寫入資料庫）</p>
      {rules.map((rule, idx) => (
        <div key={idx} className="grid grid-cols-2 gap-2 rounded border border-zinc-800 p-2">
          <Field label="狀態碼"><input value={rule.status} onChange={e => patchRule(idx, { status: e.target.value })} className={inputCls} /></Field>
          <Field label="標籤"><input value={rule.label} onChange={e => patchRule(idx, { label: e.target.value })} className={inputCls} /></Field>
          <div className="col-span-2">
            <Field label="顏色">
              <input type="color" value={rule.color} onChange={e => patchRule(idx, { color: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" />
            </Field>
          </div>
        </div>
      ))}
      <PositionFields widget={w} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function SlotGridSettings({ w, onUpdate, onDelete }: { w: SlotGridWidget; onUpdate: (p: Partial<SlotGridWidget>) => void; onDelete: () => void }) {
  return (
    <div className="space-y-4">
      <SH icon={<LayoutGrid size={13} />} label="格位陣列屬性" color="#f43f5e" />
      <Field label="標題"><input value={w.title} onChange={e => onUpdate({ title: e.target.value })} className={inputCls} /></Field>
      
      <DataBindingSettings w={w} onUpdate={onUpdate} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="格內文字欄位"><input value={w.nameField} onChange={e => onUpdate({ nameField: e.target.value })} className={inputCls} placeholder="slot_label" /></Field>
        <Field label="狀態欄位"><input value={w.statusField} onChange={e => onUpdate({ statusField: e.target.value })} className={inputCls} placeholder="status" /></Field>
      </div>
      <Field label="高亮狀態值 (逗號分隔)"><input value={w.activeValues.join(',')} onChange={e => onUpdate({ activeValues: e.target.value.split(',').map(s => s.trim()) })} className={inputCls} placeholder="OCCUPIED,CHARGING" /></Field>
      <Field label="版型">
        <select value={w.variant ?? 'default'} onChange={e => onUpdate({ variant: e.target.value as SlotGridWidget['variant'] })} className={selectCls}>
          <option value="default">一般</option>
          <option value="compact-row">緊湊列</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="高亮顏色"><input type="color" value={w.activeColor} onChange={e => onUpdate({ activeColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
        <Field label="空閒顏色"><input type="color" value={w.inactiveColor} onChange={e => onUpdate({ inactiveColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
        <Field label="佈局模式">
          <select value={w.layout} onChange={e => onUpdate({ layout: e.target.value as any })} className={selectCls}>
            <option value="horizontal">橫向排列</option><option value="grid">網格排列</option>
          </select>
        </Field>
        <Field label="格位間距 (px)"><input type="number" min={0} value={w.slotGap ?? 4} onChange={e => onUpdate({ slotGap: +e.target.value })} className={inputCls} /></Field>
      </div>
      <p className="text-[10px] text-zinc-500 leading-relaxed">
        格位數量由 SQL 回傳列數決定。請設定 statusColorRules 或沿用範例平面預設。
      </p>

      <PositionFields widget={w} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

// ─── (舊有元件保持簡化) ──────────────────────────────────────────────

function ImageSettings({ w, onUpdate, onDelete }: { w: ImageWidget; onUpdate: (p: Partial<ImageWidget>) => void; onDelete: () => void }) {
  return (
    <div className="space-y-3">
      <SH icon={<Image size={13} />} label="圖片屬性" color="#10b981" />
      <Field label="圖片 URL"><input value={w.src} onChange={e => onUpdate({ src: e.target.value })} className={inputCls} /></Field>
      <Field label="圓角"><input type="number" value={w.borderRadius} onChange={e => onUpdate({ borderRadius: +e.target.value })} className={inputCls} /></Field>
      <PositionFields widget={w} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function ChartAxisFields({
  label,
  axis,
  onChange,
}: {
  label: string;
  axis: ChartAxisConfig | undefined;
  onChange: (a: ChartAxisConfig) => void;
}) {
  const unit = axis?.unit ?? 'number';
  const patch = (p: Partial<ChartAxisConfig>) => onChange({ unit, ...axis, ...p });
  const boundInput = (key: 'min' | 'max', placeholder: string) => (
    <input
      value={axis?.[key] ?? ''}
      onChange={e => patch({ [key]: e.target.value === '' ? undefined : e.target.value } as Partial<ChartAxisConfig>)}
      className={inputCls}
      placeholder={placeholder}
    />
  );
  return (
    <div className="space-y-2 rounded-lg border border-zinc-800/80 p-2.5 bg-zinc-900/30">
      <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="單位">
          <select value={unit} onChange={e => patch({ unit: e.target.value as ChartAxisUnit })} className={selectCls}>
            <option value="number">數字</option>
            <option value="time">時間</option>
          </select>
        </Field>
        <Field label="軸標籤">
          <input value={axis?.label ?? ''} onChange={e => patch({ label: e.target.value })} className={inputCls} placeholder="可選" />
        </Field>
        <Field label="下限">{boundInput('min', unit === 'time' ? '07:00' : '0')}</Field>
        <Field label="上限">{boundInput('max', unit === 'time' ? '12:00' : '100')}</Field>
        {unit === 'time' && (
          <>
            <Field label="時間格式">
              <select value={axis?.timeStyle ?? 'hm'} onChange={e => patch({ timeStyle: e.target.value as 'hm' })} className={selectCls}>
                <option value="hm">時:分</option>
              </select>
            </Field>
            <Field label="時制">
              <select value={axis?.timeClock ?? '24h'} onChange={e => patch({ timeClock: e.target.value as '12h' | '24h' })} className={selectCls}>
                <option value="24h">24 小時</option>
                <option value="12h">12 小時</option>
              </select>
            </Field>
            <div className="col-span-2 space-y-2 pt-1 border-t border-zinc-800/80">
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={axis?.timeWindow?.enabled === true}
                  onChange={e => {
                    const tw = axis?.timeWindow ?? {};
                    patch({
                      timeWindow: { ...tw, enabled: e.target.checked },
                      highlightTime: e.target.checked ? undefined : axis?.highlightTime,
                    });
                  }}
                />
                與目前時間同步（過去:未來 比例滑動視窗）
              </label>
              {axis?.timeWindow?.enabled === true && (
                <div className="grid grid-cols-3 gap-2">
                  <Field label="過去比例">
                    <input
                      type="number"
                      min={1}
                      value={axis?.timeWindow?.pastRatio ?? 2}
                      onChange={e =>
                        patch({
                          timeWindow: { ...axis?.timeWindow, enabled: true, pastRatio: +e.target.value },
                        })
                      }
                      className={inputCls}
                    />
                  </Field>
                  <Field label="未來比例">
                    <input
                      type="number"
                      min={1}
                      value={axis?.timeWindow?.futureRatio ?? 4}
                      onChange={e =>
                        patch({
                          timeWindow: { ...axis?.timeWindow, enabled: true, futureRatio: +e.target.value },
                        })
                      }
                      className={inputCls}
                    />
                  </Field>
                  <Field label="視窗(分)">
                    <input
                      type="number"
                      min={60}
                      value={axis?.timeWindow?.totalMinutes ?? 360}
                      onChange={e =>
                        patch({
                          timeWindow: { ...axis?.timeWindow, enabled: true, totalMinutes: +e.target.value },
                        })
                      }
                      className={inputCls}
                    />
                  </Field>
                </div>
              )}
              {axis?.timeWindow?.enabled !== true && (
                <Field label="高亮時刻">
                  <input
                    value={axis?.highlightTime ?? ''}
                    onChange={e => patch({ highlightTime: e.target.value || undefined })}
                    className={inputCls}
                    placeholder="09:00"
                  />
                </Field>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LineChartSeriesFields({
  series,
  onChange,
  onRemove,
}: {
  series: LineChartSeriesConfig;
  onChange: (s: LineChartSeriesConfig) => void;
  onRemove: () => void;
}) {
  const patch = (p: Partial<LineChartSeriesConfig>) => onChange({ ...series, ...p });
  const patchLabelStyle = (p: Partial<LineChartEventLabelStyle>) =>
    patch({ eventLabelStyle: { ...series.eventLabelStyle, ...p } });

  return (
    <div className="space-y-2 rounded-lg border border-zinc-800/80 p-2.5 bg-zinc-900/30 relative group">
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-2 right-2 p-1 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 rounded opacity-0 group-hover:opacity-100"
        title="移除此線"
      >
        <X size={12} />
      </button>
      <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide pr-6">資料線</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Y 欄位">
          <input value={series.yField} onChange={e => patch({ yField: e.target.value })} className={inputCls} placeholder="actual_util" />
        </Field>
        <Field label="線色">
          <input
            type="color"
            value={series.color?.startsWith('#') ? series.color : '#38bdf8'}
            onChange={e => patch({ color: e.target.value })}
            className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer"
          />
        </Field>
        <Field label="圖例名稱">
          <input
            value={series.label ?? ''}
            onChange={e => patch({ label: e.target.value || undefined })}
            className={inputCls}
            placeholder="可選"
          />
        </Field>
        <Field label="線寬(px)">
          <input
            type="number"
            min={1}
            max={8}
            value={series.strokeWidth ?? 2}
            onChange={e => patch({ strokeWidth: +e.target.value })}
            className={inputCls}
          />
        </Field>
      </div>
      <div className="space-y-2 pt-2 border-t border-zinc-800">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={series.eventLabelsEnabled === true}
            onChange={e => patch({ eventLabelsEnabled: e.target.checked })}
          />
          事件標籤
        </label>
        {series.eventLabelsEnabled === true && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="標籤欄位">
              <input
                value={series.eventLabelField ?? ''}
                onChange={e => patch({ eventLabelField: e.target.value || undefined })}
                className={inputCls}
                placeholder="anomaly_label"
              />
            </Field>
            <Field label="旗標欄位（可選）">
              <input
                value={series.eventFlagField ?? ''}
                onChange={e => patch({ eventFlagField: e.target.value || undefined })}
                className={inputCls}
                placeholder="is_anomaly"
              />
            </Field>
            <Field label="字級(px)">
              <input
                type="number"
                min={8}
                max={24}
                value={series.eventLabelStyle?.fontSize ?? ''}
                placeholder="11"
                onChange={e =>
                  patchLabelStyle({ fontSize: e.target.value === '' ? undefined : +e.target.value })
                }
                className={inputCls}
              />
            </Field>
            <Field label="字重">
              <select
                value={String(series.eventLabelStyle?.fontWeight ?? 'normal')}
                onChange={e =>
                  patchLabelStyle({
                    fontWeight: e.target.value === 'bold' ? 'bold' : 'normal',
                  })
                }
                className={selectCls}
              >
                <option value="normal">一般</option>
                <option value="bold">粗體</option>
              </select>
            </Field>
            <Field label="文字色">
              <input
                type="color"
                value={series.eventLabelStyle?.fill?.startsWith('#') ? series.eventLabelStyle.fill : '#fca5a5'}
                onChange={e => patchLabelStyle({ fill: e.target.value })}
                className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer"
              />
            </Field>
            <Field label="外框色">
              <input
                type="color"
                value={series.eventLabelStyle?.stroke?.startsWith('#') ? series.eventLabelStyle.stroke : '#ef4444'}
                onChange={e => patchLabelStyle({ stroke: e.target.value })}
                className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer"
              />
            </Field>
            <Field label="外框粗細">
              <input
                type="number"
                min={0}
                max={4}
                step={0.5}
                value={series.eventLabelStyle?.strokeWidth ?? ''}
                placeholder="1.5"
                onChange={e =>
                  patchLabelStyle({
                    strokeWidth: e.target.value === '' ? undefined : +e.target.value,
                  })
                }
                className={inputCls}
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

function AxisBandFields({
  band,
  onChange,
}: {
  band: ChartAxisBandConfig;
  onChange: (band: ChartAxisBandConfig) => void;
}) {
  const patch = (p: Partial<ChartAxisBandConfig>) => onChange({ ...band, ...p });
  const rules = band.colorRules ?? [];
  const addRule = () => patch({ colorRules: [...rules, { value: '', color: '#64748b' }] });
  const removeRule = (idx: number) => patch({ colorRules: rules.filter((_, i) => i !== idx) });
  const updateRule = (idx: number, p: Partial<ChartAxisBandColorRule>) =>
    patch({ colorRules: rules.map((r, i) => (i === idx ? { ...r, ...p } : r)) });

  return (
    <div className="space-y-2 rounded-lg border border-zinc-800/80 p-2.5 bg-zinc-900/30">
      <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">{band.axis.toUpperCase()} 軸區段色帶</p>
      <p className="text-[10px] text-zinc-500 leading-relaxed">
        資料庫提供區段識別與時間界線；顏色在此依欄位值對應（不存於 DB）。
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="起點欄位">
          <input value={band.startField ?? ''} onChange={e => patch({ startField: e.target.value || undefined })} className={inputCls} placeholder={band.axis === 'x' ? 'time' : 'value'} />
        </Field>
        <Field label="終點欄位">
          <input value={band.endField ?? ''} onChange={e => patch({ endField: e.target.value || undefined })} className={inputCls} placeholder="可留空(用下一筆)" />
        </Field>
        <Field label="區段識別欄位">
          <input value={band.segmentField} onChange={e => patch({ segmentField: e.target.value })} className={inputCls} placeholder="segment_code" />
        </Field>
        <Field label="無匹配時預設色">
          <input type="color" value={band.defaultColor?.startsWith('#') ? band.defaultColor : '#64748b'} onChange={e => patch({ defaultColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" />
        </Field>
        <Field label="厚度(px)">
          <input type="number" min={1} max={20} value={band.thickness ?? 4} onChange={e => patch({ thickness: +e.target.value })} className={inputCls} />
        </Field>
        <Field label="透明度(0~1)">
          <input type="number" min={0} max={1} step={0.1} value={band.opacity ?? 1} onChange={e => patch({ opacity: +e.target.value })} className={inputCls} />
        </Field>
      </div>
      <div className="space-y-1.5 pt-1 border-t border-zinc-800">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500 font-bold uppercase">區段值 → 顏色</span>
          <button type="button" onClick={addRule} className="p-1 text-cyan-500 hover:bg-zinc-800 rounded"><Plus size={12} /></button>
        </div>
        {rules.map((rule, i) => (
          <div key={i} className="flex items-center gap-1.5 p-1.5 bg-zinc-800/40 rounded border border-zinc-700/50 relative group">
            <button type="button" onClick={() => removeRule(i)} className="absolute -top-1.5 -right-1.5 p-0.5 bg-zinc-700 rounded-full text-zinc-400 hover:text-white opacity-0 group-hover:opacity-100"><X size={10} /></button>
            <input value={rule.value} onChange={e => updateRule(i, { value: e.target.value })} className={`${inputCls} flex-1 font-mono`} placeholder="IN_SERVICE" />
            <input type="color" value={rule.color.startsWith('#') ? rule.color : '#64748b'} onChange={e => updateRule(i, { color: e.target.value })} className="w-8 h-8 rounded border border-zinc-700 bg-transparent cursor-pointer shrink-0" />
          </div>
        ))}
        {rules.length === 0 && <p className="text-[10px] text-zinc-600 italic text-center py-1">尚未設定對應規則</p>}
      </div>
    </div>
  );
}

function LineChartSettings({ w, onUpdate, onDelete }: { w: LineChartWidget; onUpdate: (p: Partial<LineChartWidget>) => void; onDelete: () => void }) {
  const seriesList = resolveLineChartSeries(w);
  const setSeriesList = (next: LineChartSeriesConfig[]) => {
    const legacy = syncSeriesToLegacyFields(next);
    onUpdate({ series: next, ...legacy });
  };
  const xBand = w.axisBands?.find(b => b.axis === 'x');
  const yBand = w.axisBands?.find(b => b.axis === 'y');
  const setBand = (axis: 'x' | 'y', enabled: boolean) => {
    const rest = (w.axisBands ?? []).filter(b => b.axis !== axis);
    if (!enabled) {
      onUpdate({ axisBands: rest.length ? rest : undefined });
      return;
    }
    const next: ChartAxisBandConfig = {
      axis,
      segmentField: axis === 'x' ? 'segment_code' : 'range_code',
      colorRules: [
        { value: 'IN_SERVICE', color: '#f97316' },
        { value: 'SCHEDULED', color: '#22c55e' },
      ],
      defaultColor: '#64748b',
      thickness: 4,
      opacity: 1,
    };
    onUpdate({ axisBands: [...rest, next] });
  };
  const updateBand = (axis: 'x' | 'y', band: ChartAxisBandConfig) => {
    const rest = (w.axisBands ?? []).filter(b => b.axis !== axis);
    onUpdate({ axisBands: [...rest, band] });
  };
  return (
    <div className="space-y-4">
      <SH icon={<TrendingUp size={13} />} label="折線圖屬性" color="#06b6d4" />
      <Field label="標題"><input value={w.title} onChange={e => onUpdate({ title: e.target.value })} className={inputCls} /></Field>
      <DataBindingSettings w={w} onUpdate={onUpdate} />
      <div className="space-y-2 pt-2 border-t border-zinc-800">
        <SH icon={<TrendingUp size={12} />} label="內邊距（內縮）" color="#64748b" />
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          圖表繪製區會填滿 CHART 元件外框；僅透過內邊距在內部留白。請拖曳 CHART 右下角調整元件大小。
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="上"><input type="number" min={0} max={120} value={w.chartPadding?.top ?? ''} placeholder="16" onChange={e => onUpdate({ chartPadding: { ...w.chartPadding, top: e.target.value === '' ? undefined : +e.target.value } })} className={inputCls} /></Field>
          <Field label="右"><input type="number" min={0} max={120} value={w.chartPadding?.right ?? ''} placeholder="16" onChange={e => onUpdate({ chartPadding: { ...w.chartPadding, right: e.target.value === '' ? undefined : +e.target.value } })} className={inputCls} /></Field>
          <Field label="下"><input type="number" min={0} max={120} value={w.chartPadding?.bottom ?? ''} placeholder="36" onChange={e => onUpdate({ chartPadding: { ...w.chartPadding, bottom: e.target.value === '' ? undefined : +e.target.value } })} className={inputCls} /></Field>
          <Field label="左"><input type="number" min={0} max={120} value={w.chartPadding?.left ?? ''} placeholder="48" onChange={e => onUpdate({ chartPadding: { ...w.chartPadding, left: e.target.value === '' ? undefined : +e.target.value } })} className={inputCls} /></Field>
        </div>
      </div>
      <Field label="X 軸欄位"><input value={w.xField} onChange={e => onUpdate({ xField: e.target.value })} className={inputCls} /></Field>
      <div className="space-y-2 pt-2 border-t border-zinc-800">
        <div className="flex items-center justify-between">
          <SH icon={<TrendingUp size={12} />} label="折線系列" color="#06b6d4" />
          <button
            type="button"
            onClick={() =>
              setSeriesList([
                ...seriesList,
                { id: newSeriesId(), yField: 'value', color: '#22c55e', strokeWidth: 2 },
              ])
            }
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-cyan-400 hover:bg-zinc-800 rounded border border-zinc-700"
          >
            <Plus size={12} /> 新增
          </button>
        </div>
        {seriesList.map((s, i) => (
          <LineChartSeriesFields
            key={s.id}
            series={s}
            onChange={next => setSeriesList(seriesList.map((x, j) => (j === i ? next : x)))}
            onRemove={() => seriesList.length > 1 && setSeriesList(seriesList.filter((_, j) => j !== i))}
          />
        ))}
      </div>
      <div className="space-y-2 pt-2 border-t border-zinc-800">
        <SH icon={<TrendingUp size={12} />} label="座標軸" color="#22d3ee" />
        <Field label="視窗模式">
          <select
            value={w.viewportMode ?? 'fixed-axis'}
            onChange={e => onUpdate({ viewportMode: e.target.value as ChartViewportMode })}
            className={selectCls}
          >
            <option value="fixed-axis">定軸（軸固定，資料在區間內移動）</option>
            <option value="data-centered">以資料為中心（軸在允許區間內平移）</option>
          </select>
        </Field>
        {w.viewportMode === 'data-centered' && (
          <Field label="視窗留白 %">
            <input
              type="number"
              min={0}
              max={45}
              value={Math.round((w.viewportPadding ?? 0.12) * 100)}
              onChange={e => onUpdate({ viewportPadding: Math.min(0.45, Math.max(0, +e.target.value / 100)) })}
              className={inputCls}
            />
          </Field>
        )}
        <ChartAxisFields label="X 軸" axis={w.xAxis} onChange={xAxis => onUpdate({ xAxis })} />
        <ChartAxisFields label="Y 軸" axis={w.yAxis} onChange={yAxis => onUpdate({ yAxis })} />
        <div className="space-y-2 rounded-lg border border-zinc-800/80 p-2.5 bg-zinc-900/30">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">軸區段色帶（資料驅動）</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input type="checkbox" checked={!!xBand} onChange={e => setBand('x', e.target.checked)} />
              啟用 X 軸色帶
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input type="checkbox" checked={!!yBand} onChange={e => setBand('y', e.target.checked)} />
              啟用 Y 軸色帶
            </label>
          </div>
        </div>
        {xBand && <AxisBandFields band={xBand} onChange={b => updateBand('x', b)} />}
        {yBand && <AxisBandFields band={yBand} onChange={b => updateBand('y', b)} />}
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          時間軸請使用 HH:mm（如 09:00）；數字軸可設上下限。不論元件寬高，刻度依軸範圍等比縮放。
        </p>
      </div>
      <PositionFields widget={w} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function DatabaseSettings({ w, onUpdate, onDelete }: { w: DatabaseWidget; onUpdate: (p: Partial<DatabaseWidget>) => void; onDelete: () => void }) {
  return (
    <div className="space-y-4">
      <SH icon={<Database size={13} />} label="資料庫屬性" color="#a78bfa" />
      <Field label="標題"><input value={w.title} onChange={e => onUpdate({ title: e.target.value })} className={inputCls} /></Field>
      <DataBindingSettings w={w} onUpdate={onUpdate} />
      <Field label="最大行數"><input type="number" value={w.maxRows} onChange={e => onUpdate({ maxRows: +e.target.value })} className={inputCls} /></Field>
      <PositionFields widget={w} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

// ─── 平面與畫布設定 (保持) ───────────────────────────────────────────

function PlaneSettings({ plane, onUpdate, onDelete }: {
  plane: DashboardPlane;
  onUpdate: (p: Partial<Pick<DashboardPlane, 'name' | 'width' | 'height'>>) => void;
  onDelete: () => void;
}) {
  const g = gcd(plane.width, plane.height);
  return (
    <div className="space-y-6">
      <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-4 mb-2">
        <SH icon={<Settings size={14} className="text-cyan-400" />} label="目前平面設定" color="#22d3ee" />
        <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-tighter">編輯基本屬性、解析度與比例</p>
      </div>

      <div className="space-y-4 px-1">
        <Field label="平面名稱 (Name)">
          <input 
            value={plane.name} 
            onChange={e => onUpdate({ name: e.target.value })} 
            className={`${inputCls} text-sm font-semibold`} 
            placeholder="輸入平面名稱..."
          />
        </Field>
        
        <div className="grid grid-cols-2 gap-3">
          <Field label="畫布寬度 (Width)">
            <div className="relative">
              <input type="number" min={320} value={plane.width} onChange={e => onUpdate({ width: +e.target.value })} className={inputCls} />
              <span className="absolute right-2 top-1.5 text-[9px] text-zinc-600 font-mono">PX</span>
            </div>
          </Field>
          <Field label="畫布高度 (Height)">
            <div className="relative">
              <input type="number" min={240} value={plane.height} onChange={e => onUpdate({ height: +e.target.value })} className={inputCls} />
              <span className="absolute right-2 top-1.5 text-[9px] text-zinc-600 font-mono">PX</span>
            </div>
          </Field>
        </div>

        <div className="flex items-center justify-between p-3 bg-zinc-800/30 rounded-lg border border-zinc-800">
          <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">螢幕比例</div>
          <div className="px-3 py-1 bg-zinc-900 rounded text-cyan-400 font-mono text-xs shadow-inner">
            {plane.width / g} : {plane.height / g}
          </div>
        </div>

        <div className="pt-4 border-t border-zinc-800">
          <button 
            onClick={() => { if(confirm('確定要永久刪除此平面嗎？')) onDelete(); }} 
            className="w-full py-2.5 rounded-lg bg-red-950/20 border border-red-900/30 text-red-400 text-xs 
                       flex items-center justify-center gap-2 hover:bg-red-600 hover:text-white transition-all duration-300"
          >
            <Trash2 size={13} /> 刪除目前平面
          </button>
        </div>
      </div>
    </div>
  );
}

function CanvasSettings({ el, onUpdate, onDelete, onEnterEditGroupMode }: {
  el: CanvasElementProps;
  onUpdate: (p: Partial<CanvasElementProps>) => void;
  onDelete: () => void;
  onEnterEditGroupMode?: () => void;
}) {
  const maps = React.useMemo(() => getAvailableMaps(), []);
  const isMap = el.canvasKind === 'map-platform';
  return (
    <div className="space-y-4">
      <SH icon={<Layers size={13} />} label={isMap ? '圖台容器' : el.isGroup ? '畫布群組屬性' : '畫布屬性'} color={isMap ? '#0ea5e9' : el.isGroup ? '#a855f7' : '#06b6d4'} />
      <Field label="標籤"><input value={el.label} onChange={e => onUpdate({ label: e.target.value })} className={inputCls} /></Field>

      {isMap && (
        <div className="space-y-3 rounded-lg border border-sky-500/25 bg-sky-500/5 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-sky-400">圖台來源 (Map Editor)</div>
          <Field label="選擇圖台">
            <select value={el.mapId ?? ''} onChange={e => onUpdate({ mapId: e.target.value })} className={selectCls}>
              <option value="">— 請選擇圖台 —</option>
              {maps.map(m => (
                <option key={m.mapId} value={m.mapId}>{m.displayName}</option>
              ))}
            </select>
          </Field>
          <p className="text-[9px] leading-relaxed text-zinc-500">
            圖台容器寬高請與地圖編輯器中的畫布解析度（pixelSize）一致，即可 1:1 顯示且不捲動。
            若尺寸不同會等比縮放以完整放入容器。載具外觀請使用「載具容器」子元件放置於圖台上方。
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label="X"><input type="number" value={el.x} onChange={e => onUpdate({ x: +e.target.value })} className={inputCls} /></Field>
        <Field label="Y"><input type="number" value={el.y} onChange={e => onUpdate({ y: +e.target.value })} className={inputCls} /></Field>
        <Field label="寬"><input type="number" value={el.width} onChange={e => onUpdate({ width: +e.target.value })} className={inputCls} /></Field>
        <Field label="高"><input type="number" value={el.height} onChange={e => onUpdate({ height: +e.target.value })} className={inputCls} /></Field>
      </div>
      <Field label="背景顏色"><input type="color" value={el.backgroundColor} onChange={e => onUpdate({ backgroundColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
      <Field label={`透明度：${el.opacity}%`}><input type="range" min={0} max={100} value={el.opacity} onChange={e => onUpdate({ opacity: +e.target.value })} className="w-full accent-cyan-500" /></Field>

      {el.label === '事件中心' && !el.isGroup && (
        <p className="text-[10px] leading-relaxed text-zinc-500 rounded-md border border-zinc-700/80 bg-zinc-800/40 px-2.5 py-2">
          此畫布僅含標題與 KPI（SQL 彙總）。列表輪播請編輯同列的「<strong className="text-purple-300">事件輪播</strong>」群組：雙畫板左預設、右常態，資料來自群組列表 SQL。
        </p>
      )}

      {el.canvasLayer === 'overlay' && (
        <p className="text-[10px] leading-relaxed text-zinc-500 rounded-md border border-zinc-700/80 bg-zinc-800/40 px-2.5 py-2">
          疊層畫布：未選取時點擊會穿透至下層群組；選取後可編輯空狀態元件。
        </p>
      )}

      {/* 畫布群組設定 */}
      {el.isGroup && (
        <div className="pt-3 border-t border-purple-500/20 space-y-3">
          {onEnterEditGroupMode && (
            <button
              type="button"
              onClick={onEnterEditGroupMode}
              className="w-full rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold py-2.5 shadow-md"
            >
              編輯子畫布範本
            </button>
          )}
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <Database size={12} className="text-purple-400" />
            <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wide">畫布群組</span>
          </div>

          <Field label="資料呈現模式">
            <select
              value={el.groupRepeatMode || 'tile'}
              onChange={e => onUpdate({ groupRepeatMode: e.target.value as 'tile' | 'scroll' | 'slots' })}
              className={selectCls}
            >
              <option value="tile">重複排列（全部列出）</option>
              <option value="scroll">單格滾動（輪播替換）</option>
              <option value="slots">橫向格位（固定格數整塊替換）</option>
            </select>
          </Field>

          {(el.groupRepeatMode === 'scroll') && (
            <>
              <Field label="滾動間隔（秒）">
                <input
                  type="number"
                  min={2}
                  value={el.groupScrollInterval ?? 5}
                  onChange={e => onUpdate({ groupScrollInterval: +e.target.value })}
                  className={inputCls}
                />
              </Field>
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                {el.dualCanvasEnabled
                  ? '雙畫板已啟用：左側子畫布編輯預設畫板（閘道不成立時顯示），右側編輯常態輪播範本；中間直欄可設定閘道條件。'
                  : '若要無資料與有資料使用不同版面，可啟用下方「雙畫板」並分別編輯預設與常態畫板。'}
              </p>
            </>
          )}

          {(el.groupRepeatMode === 'slots') && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="格位數量">
                  <input type="number" min={1} max={12} value={el.slotCount ?? 6}
                    onChange={e => onUpdate({ slotCount: +e.target.value })} className={inputCls} />
                </Field>
                <Field label="替換識別欄位">
                  <input value={el.slotKeyField || ''} onChange={e => onUpdate({ slotKeyField: e.target.value })}
                    className={inputCls} placeholder="shift_key" />
                </Field>
              </div>
              <Field label="格位指派">
                <select
                  value={el.groupSlotAssignment ?? 'sticky-pool'}
                  onChange={e => onUpdate({ groupSlotAssignment: e.target.value as 'index' | 'sticky-pool' })}
                  className={selectCls}
                >
                  <option value="sticky-pool">固定格位池（結束釋放、候補填入）</option>
                  <option value="index">依序對應（第 i 列 → 第 i 格）</option>
                </select>
              </Field>
              <Field label="替換動畫">
                <select
                  value={el.groupTransition ?? 'flip'}
                  onChange={e => onUpdate({ groupTransition: e.target.value as 'none' | 'fade' | 'flip' })}
                  className={selectCls}
                >
                  <option value="flip">翻日曆（往上翻）</option>
                  <option value="fade">淡入位移</option>
                  <option value="none">無動畫</option>
                </select>
              </Field>
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                固定格位池：哪一格的班次先結束就先替換新資料；超過格數的候補班次同樣以動畫輪替進場。
              </p>
            </>
          )}

          <Field label="變數注入模式">
            <select
              value={el.groupVariableMode ?? 'row'}
              onChange={e => onUpdate({ groupVariableMode: e.target.value as 'index' | 'row' })}
              className={selectCls}
            >
              <option value="index">索引（子元件自行 SQL／MQTT）</option>
              <option value="row">整列欄位（舊版相容）</option>
            </select>
          </Field>

          <div className="p-2.5 bg-zinc-800/50 rounded-lg border border-zinc-700/50 space-y-1.5">
            <div className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">變數注入</div>
            <div className="text-[10px] text-zinc-400 leading-relaxed">
              {(el.groupVariableMode ?? 'row') === 'index'
                ? <>僅注入列索引 <code className="text-purple-300 font-mono">{`{${el.variableName || 'item'}}`}</code>；子元件在 SQL／MQTT 中用 OFFSET 或主題變數承接。</>
                : <>每列欄位注入為變數，文字可用 <code className="text-zinc-400 font-mono">{`{欄位名稱}`}</code>。</>}
            </div>
          </div>

          <DualCanvasSettings el={el} onUpdate={onUpdate} />

          <DataBindingSettings w={el as any} onUpdate={onUpdate as any} />

          <div className="grid grid-cols-2 gap-2">
            <Field label="資料表變數欄位">
              <input value={el.iteratorField || ''} onChange={e => onUpdate({ iteratorField: e.target.value })} className={inputCls} placeholder="例如: id" />
            </Field>
            <Field label="內部變數名稱">
              <input value={el.variableName || ''} onChange={e => onUpdate({ variableName: e.target.value })} className={inputCls} placeholder="例如: item" />
            </Field>
          </div>

          <Field label="範本填滿方式">
            <select
              value={el.groupTileFit || 'fill'}
              onChange={e => onUpdate({ groupTileFit: e.target.value as 'fixed' | 'fill' | 'slot' })}
              className={selectCls}
            >
              <option value="slot">固定槽寬（依欄數，有幾筆顯示幾格）</option>
              <option value="fill">填滿畫布（依資料筆數分配欄寬）</option>
              <option value="fixed">固定範本尺寸</option>
            </select>
            <p className="mt-1 text-[10px] text-zinc-500 leading-relaxed">
              {(el.groupTileFit || 'fill') === 'slot'
                ? '單格寬度 =（群組寬 − 邊距 − 間距）÷ 欄數；執行時子範本會依 template W×H 拉伸填滿單格（群組改大小仍貼滿）。'
                : (el.groupTileFit || 'fill') === 'fill'
                  ? '子範本會撐滿群組畫布；下方 W×H 僅在「固定尺寸」時作為排版基準。'
                  : '使用固定 W×H；可搭配欄數與間距排列，畫布較大時可置中。'}
            </p>
          </Field>

          <Field label="子範本尺寸 (W × H)">
            <div className="flex gap-2">
              <input type="number" value={el.templateWidth || 300} onChange={e => onUpdate({ templateWidth: +e.target.value })} className={inputCls} />
              <input type="number" value={el.templateHeight || 180} onChange={e => onUpdate({ templateHeight: +e.target.value })} className={inputCls} />
            </div>
            {(el.groupTileFit || 'fill') === 'slot' && (
              <p className="mt-1 text-[10px] text-amber-500/90">
                建議 W×H = 單槽尺寸（欄數 {el.gridColumns || 11} 時約{' '}
                {(() => {
                  const padX = el.groupTilePadX ?? el.groupTilePadding ?? 4;
                  const padY = el.groupTilePadY ?? el.groupTilePadding ?? 4;
                  const s = Math.floor(
                    ((el.width || 300) - padX * 2 - (el.gapX ?? 12) * ((el.gridColumns || 11) - 1)) /
                      (el.gridColumns || 11),
                  );
                  const h = (el.height || 180) - padY * 2;
                  return `${s}×${h}`;
                })()}
                ）
              </p>
            )}
          </Field>

          {(el.groupTileFit || 'fill') === 'fixed' && (
            <Field label="水平對齊（固定尺寸）">
              <select
                value={el.groupTileAlign || 'start'}
                onChange={e => onUpdate({ groupTileAlign: e.target.value as 'start' | 'center' })}
                className={selectCls}
              >
                <option value="start">靠左</option>
                <option value="center">置中</option>
              </select>
            </Field>
          )}

          <Field label="佈局模式">
            <select value={el.layoutMode || 'grid'} onChange={e => onUpdate({ layoutMode: e.target.value as 'free' | 'grid' })} className={selectCls}>
              <option value="grid">網格排列</option>
              <option value="free">自由排列 (依資料欄位)</option>
            </select>
          </Field>

          {(el.layoutMode === 'grid' || !el.layoutMode) ? (
            <div className="grid grid-cols-3 gap-2">
              <Field label="欄數"><input type="number" value={el.gridColumns || 1} onChange={e => onUpdate({ gridColumns: +e.target.value })} className={inputCls} /></Field>
              <Field label="X 間距"><input type="number" value={el.gapX ?? 12} onChange={e => onUpdate({ gapX: +e.target.value })} className={inputCls} /></Field>
              <Field label="Y 間距"><input type="number" value={el.gapY ?? 12} onChange={e => onUpdate({ gapY: +e.target.value })} className={inputCls} /></Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Field label="X 欄位"><input value={el.xField || ''} onChange={e => onUpdate({ xField: e.target.value })} className={inputCls} placeholder="例如: x" /></Field>
              <Field label="Y 欄位"><input value={el.yField || ''} onChange={e => onUpdate({ yField: e.target.value })} className={inputCls} placeholder="例如: y" /></Field>
            </div>
          )}
        </div>
      )}

      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function PositionFields({ widget, onUpdate }: { widget: ChildWidget; onUpdate: (p: Partial<ChildWidget>) => void }) {
  return (
    <div className="pt-2 border-t border-zinc-800">
      <div className="text-zinc-600 text-[10px] uppercase font-bold mb-2 tracking-wider">位置與尺寸</div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="X"><input type="number" value={widget.x} onChange={e => onUpdate({ x: +e.target.value } as any)} className={inputCls} /></Field>
        <Field label="Y"><input type="number" value={widget.y} onChange={e => onUpdate({ y: +e.target.value } as any)} className={inputCls} /></Field>
        <Field label="寬"><input type="number" value={widget.width} onChange={e => onUpdate({ width: +e.target.value } as any)} className={inputCls} /></Field>
        <Field label="高"><input type="number" value={widget.height} onChange={e => onUpdate({ height: +e.target.value } as any)} className={inputCls} /></Field>
        <Field label="旋轉 (°)">
          <input
            type="number"
            value={widget.rotationDeg ?? 0}
            onChange={(e) => onUpdate({ rotationDeg: +e.target.value } as Partial<ChildWidget>)}
            className={inputCls}
          />
        </Field>
      </div>
    </div>
  );
}
// ─── 新元件設定面板 ───────────────────────────────────────────────────────────

function ColorBlockSettings({ w, onUpdate, onDelete }: { w: ColorBlockWidget; onUpdate: (p: Partial<ColorBlockWidget>) => void; onDelete: () => void }) {
  return (
    <div className="space-y-4">
      <SH icon={<Square size={13} />} label="色塊屬性" color="#64748b" />
      <div className="grid grid-cols-2 gap-2">
        <Field label="背景顏色">
          <div className="flex gap-2">
            <input type="color" value={w.backgroundColor.startsWith('#') ? w.backgroundColor : '#1e293b'}
              onChange={e => onUpdate({ backgroundColor: e.target.value })} className="w-8 h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" />
            <input value={w.backgroundColor} onChange={e => onUpdate({ backgroundColor: e.target.value })} className={`${inputCls} font-mono`} />
          </div>
        </Field>
        <Field label={`透明度 ${w.opacity}%`}>
          <input type="range" min={0} max={100} value={w.opacity} onChange={e => onUpdate({ opacity: +e.target.value })} className="w-full accent-cyan-500" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="圓角"><input type="number" min={0} value={w.borderRadius} onChange={e => onUpdate({ borderRadius: +e.target.value })} className={inputCls} /></Field>
        <Field label="外框粗細"><input type="number" min={0} value={w.borderWidth} onChange={e => onUpdate({ borderWidth: +e.target.value })} className={inputCls} /></Field>
        <Field label="外框顏色"><input type="color" value={w.borderColor.startsWith('#') ? w.borderColor : '#ffffff'} onChange={e => onUpdate({ borderColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <input type="checkbox" checked={!!w.severityStripColor}
          onChange={e => onUpdate({ severityStripColor: e.target.checked })} />
        依 severity 變色（需 SQL 回傳 severity 欄位）
      </label>
      {w.severityStripColor && (
        <div className="pt-2 border-t border-zinc-800">
          <SH icon={<Database size={13} />} label="severity 資料" color="#a78bfa" />
          <div className="mt-2">
            <DataBindingSettings w={w} onUpdate={onUpdate} />
          </div>
        </div>
      )}
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <input type="checkbox" checked={!!w.bindBorderFromHealthField}
          onChange={e => onUpdate({ bindBorderFromHealthField: e.target.checked })} />
        依健康狀態欄位映射外框色（MQTT）
      </label>
      {w.bindBorderFromHealthField && (
        <Field label="健康狀態欄位鍵">
          <input value={w.healthFieldForBorder ?? ''} onChange={e => onUpdate({ healthFieldForBorder: e.target.value })} className={inputCls} placeholder="health_status" />
        </Field>
      )}
      <Field label="邊框色變數鍵（可選）">
        <input value={w.bindBorderColorVar ?? ''} onChange={e => onUpdate({ bindBorderColorVar: e.target.value })} className={inputCls} placeholder="card_border_color" />
      </Field>
      <div className="text-[9px] text-zinc-600 bg-zinc-800/50 p-2 rounded border border-zinc-700/50 italic">
        💡 色塊會自動置於其他元件的底層（z-index 最低）
      </div>
      <PositionFields widget={w as any} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function StatusBadgeSettings({ w, onUpdate, onDelete }: { w: StatusBadgeWidget; onUpdate: (p: Partial<StatusBadgeWidget>) => void; onDelete: () => void }) {
  const addRule = () => onUpdate({ rules: [...w.rules, { value: 'NEW', label: 'NEW', bgColor: '#1e3a5f', textColor: '#60a5fa' }] });
  const removeRule = (i: number) => onUpdate({ rules: w.rules.filter((_, j) => j !== i) });
  const updateRule = (i: number, p: Partial<StatusBadgeRule>) => onUpdate({ rules: w.rules.map((r, j) => j === i ? { ...r, ...p } : r) });

  return (
    <div className="space-y-4">
      <SH icon={<Tag size={13} />} label="狀態徽章屬性" color="#22c55e" />
      <DataBindingSettings w={w as any} onUpdate={onUpdate as any} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="資料欄位"><input value={w.valueField} onChange={e => onUpdate({ valueField: e.target.value })} className={inputCls} placeholder="status" /></Field>
        <Field label="預設標籤"><input value={w.defaultLabel} onChange={e => onUpdate({ defaultLabel: e.target.value })} className={inputCls} placeholder="UNKNOWN" /></Field>
        <Field label="預設背景色"><input type="color" value={w.defaultBgColor} onChange={e => onUpdate({ defaultBgColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
        <Field label="預設文字色"><input type="color" value={w.defaultTextColor} onChange={e => onUpdate({ defaultTextColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
        <Field label="字體大小"><input type="number" value={w.fontSize} onChange={e => onUpdate({ fontSize: +e.target.value })} className={inputCls} /></Field>
        <Field label="圓角"><input type="number" min={0} value={w.borderRadius} onChange={e => onUpdate({ borderRadius: +e.target.value })} className={inputCls} /></Field>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={w.showDot} onChange={e => onUpdate({ showDot: e.target.checked })} className="accent-green-500 w-3 h-3" />
        <span className="text-zinc-400 text-[10px]">顯示狀態指示點</span>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500 font-bold uppercase">狀態規則映射</span>
          <button onClick={addRule} className="p-1 text-cyan-500 hover:bg-zinc-800 rounded"><Plus size={12} /></button>
        </div>
        {w.rules.map((rule, i) => (
          <div key={i} className="p-2 bg-zinc-800/40 rounded border border-zinc-700/50 space-y-1.5 relative group">
            <button onClick={() => removeRule(i)} className="absolute -top-1.5 -right-1.5 p-0.5 bg-zinc-700 rounded-full text-zinc-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"><X size={10} /></button>
            <div className="grid grid-cols-2 gap-1">
              <input value={rule.value} onChange={e => updateRule(i, { value: e.target.value })} className={`${inputCls} font-mono`} placeholder="值（如 ONLINE）" />
              <input value={rule.label} onChange={e => updateRule(i, { label: e.target.value })} className={inputCls} placeholder="顯示標籤" />
            </div>
            <div className="flex gap-2">
              <div className="flex items-center gap-1 flex-1"><input type="color" value={rule.bgColor} onChange={e => updateRule(i, { bgColor: e.target.value })} className="w-6 h-6 cursor-pointer rounded" /><span className="text-[9px] text-zinc-500">背景</span></div>
              <div className="flex items-center gap-1 flex-1"><input type="color" value={rule.textColor} onChange={e => updateRule(i, { textColor: e.target.value })} className="w-6 h-6 cursor-pointer rounded" /><span className="text-[9px] text-zinc-500">文字</span></div>
            </div>
          </div>
        ))}
      </div>
      <PositionFields widget={w as any} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function StatCardSettings({ w, onUpdate, onDelete }: { w: StatCardWidget; onUpdate: (p: Partial<StatCardWidget>) => void; onDelete: () => void }) {
  return (
    <div className="space-y-4">
      <SH icon={<Hash size={13} />} label="KPI 數值卡屬性" color="#e879f9" />
      <DataBindingSettings w={w as any} onUpdate={onUpdate as any} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="標籤文字"><input value={w.label} onChange={e => onUpdate({ label: e.target.value })} className={inputCls} placeholder="速度" /></Field>
        <Field label="資料欄位"><input value={w.valueField} onChange={e => onUpdate({ valueField: e.target.value })} className={inputCls} placeholder="speed" /></Field>
        <Field label="單位"><input value={w.unit} onChange={e => onUpdate({ unit: e.target.value })} className={inputCls} placeholder="km/h" /></Field>
        <Field label="圖示 (Lucide)"><input value={w.icon || ''} onChange={e => onUpdate({ icon: e.target.value })} className={inputCls} placeholder="Gauge" /></Field>
        <Field label="數值字體大小"><input type="number" value={w.valueFontSize} onChange={e => onUpdate({ valueFontSize: +e.target.value })} className={inputCls} /></Field>
        <Field label="標籤字體大小"><input type="number" value={w.labelFontSize} onChange={e => onUpdate({ labelFontSize: +e.target.value })} className={inputCls} /></Field>
        <Field label="單位字體大小"><input type="number" min={8} value={w.unitFontSize ?? Math.max(w.labelFontSize, 10)} onChange={e => onUpdate({ unitFontSize: +e.target.value })} className={inputCls} /></Field>
        <Field label="標籤方位（相對數值）">
          <select
            value={w.labelPosition ?? 'top'}
            onChange={e => onUpdate({ labelPosition: e.target.value as StatCardWidget['labelPosition'] })}
            className={selectCls}
          >
            <option value="top">上</option>
            <option value="bottom">下</option>
            <option value="left">左</option>
            <option value="right">右</option>
          </select>
        </Field>
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          「標籤方位」是標籤在數字旁邊的位置；「整體對齊」才是整組在卡片裡靠左／中／右。
        </p>
        <Field label="整體對齊">
          <select
            value={w.contentAlign ?? 'center'}
            onChange={e => onUpdate({ contentAlign: e.target.value as StatCardWidget['contentAlign'] })}
            className={selectCls}
          >
            <option value="left">靠左</option>
            <option value="center">置中</option>
            <option value="right">靠右</option>
          </select>
        </Field>
        <Field label="標籤／數值間距"><input type="number" min={0} max={24} value={w.layoutGap ?? 4} onChange={e => onUpdate({ layoutGap: +e.target.value })} className={inputCls} /></Field>
        <Field label="數值顏色"><input type="color" value={w.valueColor} onChange={e => onUpdate({ valueColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
        <Field label="標籤顏色"><input type="color" value={w.labelColor} onChange={e => onUpdate({ labelColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
        <Field label="單位顏色"><input type="color" value={w.unitColor} onChange={e => onUpdate({ unitColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
        <Field label="圓角"><input type="number" min={0} value={w.borderRadius} onChange={e => onUpdate({ borderRadius: +e.target.value })} className={inputCls} /></Field>
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <input type="checkbox" checked={w.labelUppercase !== false}
          onChange={e => onUpdate({ labelUppercase: e.target.checked })} />
        標籤全大寫（關閉可顯示「達成了」等中文標籤）
      </label>
      <ColorRulesEditor rules={w.colorRules} enabled={w.colorRulesEnabled} onToggleEnabled={e => onUpdate({ colorRulesEnabled: e })} onUpdate={rules => onUpdate({ colorRules: rules })} />
      <div className="pt-2 border-t border-zinc-800 space-y-2">
        <SH icon={<Hash size={12} />} label="目標比較著色（可選）" color="#38bdf8" />
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          依目標欄位自動變色（達標藍／偏離紅），僅改變數字顏色，不會多顯示其他數值。
        </p>
        <Field label="目標欄位">
          <input
            value={w.compareTargetField ?? ''}
            onChange={e => onUpdate({ compareTargetField: e.target.value || undefined })}
            className={inputCls}
            placeholder="target_val"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="容許誤差 %"><input type="number" min={0} max={50} value={w.tolerancePct ?? 5} onChange={e => onUpdate({ tolerancePct: +e.target.value })} className={inputCls} /></Field>
          <Field label="達標色"><input type="color" value={w.inBandColor ?? '#38bdf8'} onChange={e => onUpdate({ inBandColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
          <Field label="偏離色"><input type="color" value={w.outOfBandColor ?? '#f87171'} onChange={e => onUpdate({ outOfBandColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
          <Field label="提示欄位"><input value={w.hintField ?? ''} onChange={e => onUpdate({ hintField: e.target.value })} className={inputCls} placeholder="avail_hint" /></Field>
        </div>
        <Field label="提示圖示">
          <IconImageField
            value={w.hintIconImage}
            onChange={(url) => onUpdate({ hintIconImage: url, hintIcon: url ? undefined : w.hintIcon })}
          />
        </Field>
      </div>
      <PositionFields widget={w as any} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function ProgressBarSettings({ w, onUpdate, onDelete }: { w: ProgressBarWidget; onUpdate: (p: Partial<ProgressBarWidget>) => void; onDelete: () => void }) {
  return (
    <div className="space-y-4">
      <SH icon={<AlignJustify size={13} />} label="進度條屬性" color="#38bdf8" />
      <DataBindingSettings w={w as any} onUpdate={onUpdate as any} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="資料欄位"><input value={w.valueField} onChange={e => onUpdate({ valueField: e.target.value })} className={inputCls} placeholder="value" /></Field>
        <Field label="標籤文字"><input value={w.label} onChange={e => onUpdate({ label: e.target.value })} className={inputCls} placeholder="進度" /></Field>
        <Field label="最小值"><input type="number" value={w.min} onChange={e => onUpdate({ min: +e.target.value })} className={inputCls} /></Field>
        <Field label="最大值"><input type="number" value={w.max} onChange={e => onUpdate({ max: +e.target.value })} className={inputCls} /></Field>
        <Field label="方向">
          <select value={w.orientation} onChange={e => onUpdate({ orientation: e.target.value as any })} className={selectCls}>
            <option value="horizontal">水平</option>
            <option value="vertical">垂直</option>
          </select>
        </Field>
        <Field label="圓角"><input type="number" min={0} value={w.borderRadius} onChange={e => onUpdate({ borderRadius: +e.target.value })} className={inputCls} /></Field>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer">
          <input type="checkbox" checked={w.showValue} onChange={e => onUpdate({ showValue: e.target.checked })} className="accent-cyan-500 w-3 h-3" /> 顯示數值
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer">
          <input type="checkbox" checked={w.showLabel} onChange={e => onUpdate({ showLabel: e.target.checked })} className="accent-cyan-500 w-3 h-3" /> 顯示標籤
        </label>
      </div>
      <PositionFields widget={w as any} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function EmptyStateSettings({ w, onUpdate, onDelete }: { w: EmptyStateWidget; onUpdate: (p: Partial<EmptyStateWidget>) => void; onDelete: () => void }) {
  return (
    <div className="space-y-4">
      <SH icon={<CircleOff size={13} />} label="空狀態屬性" color="#94a3b8" />
      <DataBindingSettings w={w as any} onUpdate={onUpdate as any} />
      <Field label="主文案">
        <input value={w.label} onChange={e => onUpdate({ label: e.target.value })} className={inputCls} placeholder="尚無資料" />
      </Field>
      <Field label="副文案">
        <input value={w.subLabel ?? ''} onChange={e => onUpdate({ subLabel: e.target.value })} className={inputCls} placeholder="查詢結果為空" />
      </Field>
      <Field label="顯示時機">
        <select
          value={w.visibilityMode ?? 'when-empty'}
          onChange={e => onUpdate({ visibilityMode: e.target.value as EmptyStateWidget['visibilityMode'] })}
          className={selectCls}
        >
          <option value="when-empty">查詢成功且 0 筆</option>
          <option value="when-has-data">有資料時</option>
        </select>
      </Field>
      <Field label="圓角">
        <input type="number" min={0} value={w.borderRadius ?? 8} onChange={e => onUpdate({ borderRadius: +e.target.value })} className={inputCls} />
      </Field>
      <Field label="樣式">
        <select
          value={w.emptyStateVariant ?? 'default'}
          onChange={e => onUpdate({ emptyStateVariant: e.target.value as EmptyStateWidget['emptyStateVariant'] })}
          className={selectCls}
        >
          <option value="default">通用（虛線框）</option>
          <option value="minimal-center">置中極簡</option>
        </select>
      </Field>
      <p className="text-[10px] text-zinc-500 leading-relaxed">
        用於雙畫板群組的<strong className="text-zinc-400">預設畫板</strong>範本；執行時由閘道決定是否顯示（無需再疊加於外層畫布）。
      </p>
      <PositionFields widget={w as any} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function ClockSettings({ w, onUpdate, onDelete }: { w: ClockWidget; onUpdate: (p: Partial<ClockWidget>) => void; onDelete: () => void }) {
  return (
    <div className="space-y-4">
      <SH icon={<Clock size={13} />} label="時鐘屬性" color="#a3e635" />
      <div className="grid grid-cols-2 gap-2">
        <Field label="時間格式">
          <select value={w.format} onChange={e => onUpdate({ format: e.target.value as any })} className={selectCls}>
            <option value="24h">24 小時制</option>
            <option value="12h">12 小時制 (AM/PM)</option>
          </select>
        </Field>
        <Field label="日期格式">
          <select value={w.dateFormat} onChange={e => onUpdate({ dateFormat: e.target.value as any })} className={selectCls}>
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
          </select>
        </Field>
        <Field label="時間字體大小"><input type="number" value={w.fontSize} onChange={e => onUpdate({ fontSize: +e.target.value })} className={inputCls} /></Field>
        <Field label="日期字體大小"><input type="number" value={w.dateFontSize} onChange={e => onUpdate({ dateFontSize: +e.target.value })} className={inputCls} /></Field>
        <Field label="時間顏色"><input type="color" value={w.color} onChange={e => onUpdate({ color: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
        <Field label="日期顏色"><input type="color" value={w.dateColor} onChange={e => onUpdate({ dateColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer">
          <input type="checkbox" checked={w.showDate} onChange={e => onUpdate({ showDate: e.target.checked })} className="accent-cyan-500 w-3 h-3" /> 顯示日期
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer">
          <input type="checkbox" checked={w.showSeconds} onChange={e => onUpdate({ showSeconds: e.target.checked })} className="accent-cyan-500 w-3 h-3" /> 顯示秒數
        </label>
      </div>
      <PositionFields widget={w as any} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}
function BarChartSettings({ w, onUpdate, onDelete }: { w: BarChartWidget; onUpdate: (p: Partial<BarChartWidget>) => void; onDelete: () => void }) {
  return (
    <div className="space-y-4">
      <SH icon={<BarChart2 size={13} />} label="長條圖屬性" color="#f97316" />
      <Field label="標題"><input value={w.title} onChange={e => onUpdate({ title: e.target.value })} className={inputCls} /></Field>
      <DataBindingSettings w={w as any} onUpdate={onUpdate as any} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="X 軸欄位"><input value={w.xField} onChange={e => onUpdate({ xField: e.target.value })} className={inputCls} /></Field>
        <Field label="Y 軸欄位 (CSV)"><input value={w.yFields.join(',')} onChange={e => onUpdate({ yFields: e.target.value.split(',').map(s => s.trim()) })} className={inputCls} /></Field>
        <Field label="方向">
          <select value={w.orientation} onChange={e => onUpdate({ orientation: e.target.value as BarChartWidget['orientation'] })} className={selectCls}>
            <option value="vertical">垂直長條</option>
            <option value="horizontal">水平長條</option>
          </select>
        </Field>
        <Field label="Bar 間距 (0~1)"><input type="number" step={0.05} min={0} max={0.9} value={w.barPadding ?? 0.3} onChange={e => onUpdate({ barPadding: +e.target.value })} className={inputCls} /></Field>
      </div>
      <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer">
        <input type="checkbox" checked={w.showValues} onChange={e => onUpdate({ showValues: e.target.checked })} className="accent-orange-500 w-3 h-3" /> 顯示數值標籤
      </label>
      <PositionFields widget={w as any} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function UnitTelemetrySettings({
  w,
  onUpdate,
  onDelete,
}: {
  w: UnitTelemetryCardWidget;
  onUpdate: (p: Partial<UnitTelemetryCardWidget>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-4">
      <SH icon={<Monitor size={13} />} label="遙測卡屬性" color="#2dd4bf" />
      <Field label="載具標籤">
        <input value={w.unitLabel} onChange={e => onUpdate({ unitLabel: e.target.value })} className={inputCls} placeholder="UNIT-03" />
      </Field>
      <DataBindingSettings w={w} onUpdate={onUpdate} />
      <Field label="Telemetry Topic">
        <input value={w.mqttTelemetryTopic ?? ''} onChange={e => onUpdate({ mqttTelemetryTopic: e.target.value })} className={inputCls} placeholder="vehicle/{vehicle_code}/telemetry" />
      </Field>
      <Field label="Health Topic">
        <input value={w.mqttHealthTopic ?? ''} onChange={e => onUpdate({ mqttHealthTopic: e.target.value })} className={inputCls} />
      </Field>
      <Field label="版型">
        <select value={w.cardVariant ?? 'default'} onChange={e => onUpdate({ cardVariant: e.target.value as UnitTelemetryCardWidget['cardVariant'] })} className={selectCls}>
          <option value="default">一般遙測卡</option>
          <option value="instrument-row">儀表列</option>
        </select>
      </Field>
      <PositionFields widget={w} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function MapCanvasSettings({ w, onUpdate, onDelete }: { w: MapCanvasWidget; onUpdate: (p: Partial<MapCanvasWidget>) => void; onDelete: () => void }) {
  const maps = React.useMemo(() => getAvailableMaps(), []);
  return (
    <div className="space-y-3">
      <SH icon={<Map size={13} />} label="地圖畫布 (舊版子元件)" color="#0ea5e9" />
      <Field label="地圖來源">
        <select
          value={w.mapId}
          onChange={e => onUpdate({ mapId: e.target.value })}
          className={selectCls}
        >
          <option value="">— 請選擇地圖 —</option>
          {maps.map(m => (
            <option key={m.mapId} value={m.mapId}>{m.displayName}</option>
          ))}
        </select>
        {maps.length === 0 && (
          <p className="text-[9px] text-zinc-500 mt-1">
            目前沒有可用地圖。請先在地圖編輯器中儲存正式版本。
          </p>
        )}
      </Field>
      <Field label={`縮放倍率 (${w.zoomFactor?.toFixed(1) ?? '2.0'}×)`}>
        <input
          type="range" min={0.2} max={5} step={0.1}
          value={w.zoomFactor ?? 2.0}
          onChange={e => onUpdate({ zoomFactor: +e.target.value })}
          className="w-full accent-sky-400"
        />
        <div className="flex justify-between text-[9px] text-zinc-500 mt-0.5">
          <span>放大</span><span>縮小</span>
        </div>
      </Field>
      <PositionFields widget={w as any} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function VehicleContainerSettings({
  w,
  onUpdate,
  onDelete,
  onEnterEdit,
}: {
  w: VehicleContainerWidget;
  onUpdate: (p: Partial<VehicleContainerWidget>) => void;
  onDelete: () => void;
  onEnterEdit?: () => void;
}) {
  const rules = w.actionIconRules ?? [];

  const updateRule = (idx: number, patch: Partial<RouteActionIconRule>) => {
    const next = [...rules];
    next[idx] = { ...next[idx], ...patch };
    onUpdate({ actionIconRules: next });
  };

  const ACTION_MATCH_OPS: { value: RouteActionMatchOp; label: string }[] = [
    { value: 'eq', label: '等於' },
    { value: 'gte', label: '≥' },
    { value: 'gt', label: '>' },
    { value: 'present', label: '有值' },
  ];

  return (
    <div className="space-y-3">
      <p className="text-[10px] leading-relaxed text-zinc-500">
        編輯時地圖上只會顯示這一個樣板（黃框）。執行後圖台才依 MQTT 在各地點複製樣板、顯示多輛即時車輛。
      </p>
      <Field label="顯示標籤">
        <input
          value={w.label ?? ''}
          onChange={(e) => onUpdate({ label: e.target.value })}
          className={inputCls}
          placeholder="載具"
        />
      </Field>
      <button
        type="button"
        onClick={onEnterEdit}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 py-2.5 text-xs font-semibold text-white hover:bg-amber-500"
      >
        <Bus size={14} />
        編輯載具樣式
      </button>

      <SH icon={<Zap size={14} className="text-violet-400" />} label="作動行為" color="#a78bfa" />
      <WidgetDataBindingSettings w={w} onUpdate={onUpdate} />
      <div className="grid grid-cols-3 gap-2">
        <Field label="偏移 X">
          <input
            type="number"
            value={w.behaviorOffsetX ?? 0}
            onChange={(e) => onUpdate({ behaviorOffsetX: Number(e.target.value) })}
            className={inputCls}
          />
        </Field>
        <Field label="偏移 Y">
          <input
            type="number"
            value={w.behaviorOffsetY ?? -28}
            onChange={(e) => onUpdate({ behaviorOffsetY: Number(e.target.value) })}
            className={inputCls}
          />
        </Field>
        <Field label="圖示尺寸">
          <input
            type="range"
            min={8}
            max={64}
            step={1}
            value={w.behaviorIconSize ?? 20}
            onChange={(e) => onUpdate({ behaviorIconSize: Number(e.target.value) })}
            className="w-full accent-violet-500"
          />
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={8}
              max={64}
              value={w.behaviorIconSize ?? 20}
              onChange={(e) =>
                onUpdate({
                  behaviorIconSize: Math.min(64, Math.max(8, Number(e.target.value) || 20)),
                })
              }
              className={inputCls}
            />
            <span className="shrink-0 text-[9px] text-zinc-500">px · 畫布右下角可拖曳</span>
          </div>
        </Field>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-zinc-400">作動行為規則</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onUpdate({ actionIconRules: buildVehicleBehaviorActionRules('operation_action') })}
              className="rounded bg-zinc-800 px-2 py-0.5 text-[9px] text-zinc-400 hover:text-amber-400"
            >
              11 種
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdate({
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
            點「＋」逐條新增狀態規則並選擇圖示；單一圖示置中，多個由左至右排列。
          </p>
        )}
        {rules.map((rule, i) => (
          <div key={rule.id} className="space-y-1.5 rounded border border-zinc-700/50 bg-zinc-800/30 p-2">
            <div className="flex gap-1">
              <select
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
              </select>
              <button
                type="button"
                onClick={() => onUpdate({ actionIconRules: rules.filter((_, j) => j !== i) })}
                className="p-1 text-zinc-500 hover:text-red-400"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <input
              value={rule.sourceVarKey}
              onChange={(e) => updateRule(i, { sourceVarKey: e.target.value })}
              className={inputCls}
              placeholder="變數鍵"
              style={{ fontSize: 10 }}
            />
            <div className="grid grid-cols-2 gap-1">
              <select
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
              </select>
              <input
                value={rule.threshold ?? ''}
                onChange={(e) => updateRule(i, { threshold: e.target.value })}
                className={inputCls}
                placeholder="門檻"
                style={{ fontSize: 10 }}
                disabled={rule.matchOp === 'present'}
              />
            </div>
          </div>
        ))}
      </div>

      <PositionFields widget={w as ChildWidget} onUpdate={onUpdate as (p: Partial<ChildWidget>) => void} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function DeleteBtn({ onDelete }: { onDelete: () => void }) {
  return (
    <button onClick={onDelete} className="w-full py-2 rounded-lg bg-red-900/20 border border-red-800/40 text-red-400 text-[10px] font-bold uppercase flex items-center justify-center gap-1.5 hover:bg-red-900/40 transition-colors mt-2">
      <Trash2 size={12} /> 移除元件
    </button>
  );
}

interface Props {
  isEditMode: boolean;
  activePlane: DashboardPlane | null;
  /** 正在編輯群組範本時顯示於面板標題 */
  editingGroupLabel?: string;
  /** 子畫布編輯中的群組（供繼承變數與資料綁定說明） */
  editingGroup?: CanvasElementProps | null;
  selectedElement: CanvasElementProps | null;
  selectedChild: ChildWidget | null;
  selectedChildCount?: number;
  onUpdatePlane: (p: Partial<Pick<DashboardPlane, 'name' | 'width' | 'height'>>) => void;
  onDeletePlane: () => void;
  onUpdateElement: (p: Partial<CanvasElementProps>) => void;
  onDeleteElement: () => void;
  onUpdateChild: (p: Partial<ChildWidget>) => void;
  onDeleteChild: () => void;
  onEnterEditGroupMode?: (groupId: string) => void;
  onEnterEditVehicleContainer?: () => void;
  /** 雙畫板子畫布：選取中間閘道設定區 */
  dualGateSettingsActive?: boolean;
}

export function PropertiesPanel({
  isEditMode,
  activePlane,
  editingGroupLabel,
  editingGroup,
  selectedElement,
  selectedChild,
  selectedChildCount = 0,
  onUpdatePlane, onDeletePlane,
  onUpdateElement, onDeleteElement,
  onUpdateChild, onDeleteChild,
  onEnterEditGroupMode,
  onEnterEditVehicleContainer,
  dualGateSettingsActive,
}: Props) {
  const { issueMap } = useBindingHealth();
  const selectedIssue = selectedChild
    ? issueMap.get(selectedChild.id)
    : selectedElement
      ? issueMap.get(selectedElement.id)
      : undefined;

  if (!activePlane) {
    return (
      <aside className="w-64 bg-zinc-900 border-l border-zinc-800 flex items-center justify-center">
        <p className="text-zinc-600 text-xs text-center px-4">請先建立或選擇一個平面</p>
      </aside>
    );
  }

  if (!isEditMode) {
    return (
      <aside className="w-64 bg-zinc-900 border-l border-zinc-800 flex flex-col items-center justify-center p-6 text-center gap-3">
        <Monitor size={28} className="text-zinc-600" />
        <p className="text-zinc-400 text-sm font-medium">檢視模式</p>
        <p className="text-zinc-500 text-xs leading-relaxed">
          點擊元件不會變更設定。請按上方「切換編輯模式」或鍵盤 <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-400">E</kbd> 進入編輯。
        </p>
        <p className="text-zinc-600 text-[10px] font-mono">{activePlane.name}</p>
      </aside>
    );
  }

  return (
    <aside className="w-64 bg-zinc-900 border-l border-zinc-800 overflow-y-auto">
      <div className="p-4">
        {dualGateSettingsActive && editingGroup ? (
          <div className="mb-3 p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-800/40 text-cyan-200/90 text-[10px] leading-relaxed">
            <p className="font-semibold text-cyan-400 mb-1">雙畫板閘道 · {editingGroupLabel}</p>
            <p>設定何時顯示常態畫板；條件不成立且已啟用預設畫板時，改顯示左側預設範本。</p>
          </div>
        ) : editingGroupLabel && editingGroup && !selectedChild ? (
          <GroupInheritedVariablesSection group={editingGroup} />
        ) : editingGroupLabel ? (
          <div className="mb-3 p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-800/40 text-cyan-200/90 text-[10px] leading-relaxed">
            <p className="font-semibold text-cyan-400 mb-1">子畫布範本 · {editingGroupLabel}</p>
            <p>
              {editingGroup?.dualCanvasEnabled
                ? '左右兩側分別編輯預設與常態範本；紫色虛線為執行裁切區，中間直欄為閘道設定。'
                : '編輯區可放置元件；紫色虛線為執行範本裁切區。'}
              {editingGroup && (editingGroup.groupVariableMode ?? 'row') === 'index' && (
                <>
                  {' '}預覽索引{' '}
                  <span className="font-mono text-cyan-300">
                    {`{${editingGroup.variableName || 'item'}}=0`}
                  </span>
                  。
                </>
              )}
            </p>
          </div>
        ) : selectedIssue ? (
          <div className="mb-3 flex gap-2 p-2.5 rounded-lg bg-amber-950/50 border border-amber-600/40 text-amber-200 text-[10px] leading-relaxed">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-400" />
            <span>{selectedIssue.detail}</span>
          </div>
        ) : null}
        {dualGateSettingsActive && editingGroup ? (
          <DualCanvasSettings el={editingGroup} onUpdate={onUpdateElement} />
        ) : selectedChildCount > 1 ? (
          <div className="space-y-3 text-center py-8">
            <p className="text-zinc-300 text-sm font-medium">已選取 {selectedChildCount} 個元件</p>
            <p className="text-zinc-500 text-xs leading-relaxed px-2">
              可一起拖曳或方向鍵微調；按 Delete 一次刪除全部。Shift+點擊加選，Shift+拖曳框選。
            </p>
          </div>
        ) : selectedChild ? (
          (() => {
            const props = { w: selectedChild, onUpdate: onUpdateChild, onDelete: onDeleteChild };
            switch (selectedChild.type) {
              case 'text':           return <TextSettings {...props as any} editingGroup={editingGroup} />;
              case 'alert-banner':   return <AlertBannerSettings {...props as any} />;
              case 'image':          return <ImageSettings {...props as any} />;
              case 'line-chart':     return <LineChartSettings {...props as any} />;
              case 'bar-chart':      return <BarChartSettings {...props as any} />;
              case 'database':       return <DatabaseSettings {...props as any} />;
              case 'gauge':          return <GaugeSettings {...props as any} />;
              case 'slot-grid':      return <SlotGridSettings {...props as any} />;
              case 'route-progress': return <RouteProgressSettings {...props as any} />;
              case 'color-block':    return <ColorBlockSettings {...props as any} />;
              case 'status-badge':   return <StatusBadgeSettings {...props as any} />;
              case 'stat-card':      return <StatCardSettings {...props as any} />;
              case 'progress-bar':   return <ProgressBarSettings {...props as any} />;
              case 'segment-bar':    return <SegmentBarSettings {...props as any} />;
              case 'clock':          return <ClockSettings {...props as any} />;
              case 'empty-state':    return <EmptyStateSettings {...props as any} />;
              case 'map-canvas':     return <MapCanvasSettings {...props as any} />;
              case 'unit-telemetry-card': return <UnitTelemetrySettings {...props as any} />;
              case 'vehicle-container':
                return (
                  <VehicleContainerSettings
                    w={selectedChild as VehicleContainerWidget}
                    onUpdate={onUpdateChild as (p: Partial<VehicleContainerWidget>) => void}
                    onDelete={onDeleteChild}
                    onEnterEdit={onEnterEditVehicleContainer}
                  />
                );
              default:
                return (
                  <div className="space-y-3 p-2 text-xs text-zinc-500">
                    <p>此元件類型已不支援，請刪除後改用元件列中的通用元件。</p>
                    <button type="button" onClick={props.onDelete} className="w-full rounded bg-red-900/40 py-2 text-red-400">刪除元件</button>
                  </div>
                );
            }
          })()
        ) : selectedElement ? (
          <CanvasSettings
            el={selectedElement}
            onUpdate={onUpdateElement}
            onDelete={onDeleteElement}
            onEnterEditGroupMode={
              !editingGroupLabel && selectedElement.isGroup && onEnterEditGroupMode
                ? () => onEnterEditGroupMode(selectedElement.id)
                : undefined
            }
          />
        ) : (
          <PlaneSettings plane={activePlane} onUpdate={onUpdatePlane} onDelete={onDeletePlane} />
        )}
      </div>
    </aside>
  );
}
