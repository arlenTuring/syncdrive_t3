import { NumberInput } from '../../components/NumberInput'
import React, { useEffect, useState } from 'react';
import { usePlaneSourceResolver } from './context/PlaneDataSourceContext';
import { getDataSourceById } from './store/useDataSourceStore';
import { resolvePlaneRestUrl } from './elements/useWidgetData';
import { stationEtaUrl, stationEvents } from './elements/StationEtaWidget';
import { useTranslation } from 'react-i18next';
import { useBindingHealth } from './context/BindingHealthContext';
import type { 
  DashboardPlane, CanvasElementProps, ChildWidget, TextWidget, ImageWidget, 
  LineChartWidget, LineChartSeriesConfig, LineChartEventLabelStyle, ChartAxisBandConfig, ChartAxisBandColorRule, ChartAxisConfig, ChartAxisUnit, ChartViewportMode, DatabaseWidget, GaugeWidget, SlotGridWidget, MaintenanceDistributionWidget, ColorRule, WidgetDataBinding,
  ColorBlockWidget, StatusBadgeWidget, StatusBadgeRule,
  StatCardWidget, ProgressBarWidget, ClockWidget, StationEtaWidget, EmptyStateWidget, SegmentBarWidget, SegmentBarColorRule, BarChartWidget, MapCanvasWidget,
  AlertBannerWidget, AlertRule, AlertTriggerMode, AlertDisplayMode,
  UnitTelemetryCardWidget,
  VehicleContainerWidget,
  RouteActionIconRule,
  RouteActionMatchOp,
  TabListWidget,
  TabListTab,
  TabListColumn,
} from './types';
import {
  buildVehicleBehaviorActionRules,
  VEHICLE_BEHAVIOR_ACTION_CATALOG,
} from '../vehicle-editor/constants/behaviorActionCatalog';
import { WidgetDataBindingContext, WidgetDataBindingSettings } from './elements/WidgetDataBindingSettings';
import { createEmptyAlertRule, coerceAlertRule, getEditorAlertRules } from './utils/alertTrigger';
import { newSeriesId, resolveLineChartSeries, syncSeriesToLegacyFields } from './elements/lineChartSeries';
import * as LucideIcons from 'lucide-react';
import { 
  Layers, Trash2, Settings, Type, Image, TrendingUp, Database, 
  Gauge, LayoutGrid, Plus, X, Palette,
  Square, Tag, Hash, AlignJustify, Clock, BarChart2, Map, AlertTriangle, CircleOff, Monitor, Bus, Zap, List, Edit3,
  AlignLeft, AlignCenter, AlignRight
} from 'lucide-react';
import { getAvailableMaps, getAvailableMapsAsync } from './elements/mapCanvasStorage';
import { RouteProgressSettings } from './route-progress/RouteProgressSettings';
import { TextAlignmentControls } from '../../components/TextAlignmentControls';
import {
  resolveTextHorizontalAlign,
  resolveTextVerticalAlign,
} from '../../lib/textAlignment';
import { IconImageField } from './components/IconImageField';
import { DualCanvasSettings } from './components/DualCanvasSettings';
import { GenericGroupSettings } from './components/GenericGroupSettings';
import { VehicleRoofIndicatorSettings } from './components/VehicleRoofIndicatorSettings';
import { applyTabListContentFontSize } from './elements/TabListWidget';
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
  const { t } = useTranslation();
  const rowVar = group.variableName || 'item';
  const indexMode = (group.groupVariableMode ?? 'row') === 'index';
  const hasListSql = !!(group.dataSourceId && group.sqlQuery?.trim());
  const token = `{${rowVar}}`;

  return (
    <div className="mb-4 p-3 rounded-lg bg-purple-950/25 border border-purple-700/40 space-y-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-purple-300">
        {t('dashboard.properties.inheritedVars')}
      </div>
      {indexMode ? (
        <p className="text-[10px] text-zinc-400 leading-relaxed">
          {t('dashboard.properties.inheritedIndex', { token })}
          <code className="block mt-1 text-[9px] text-zinc-500 font-mono leading-relaxed">
            LIMIT 1 OFFSET {'{'}{rowVar}{'}'}
          </code>
        </p>
      ) : (
        <p className="text-[10px] text-zinc-400 leading-relaxed">
          {t('dashboard.properties.inheritedRow', {
            token: t('dashboard.properties.fieldNameToken'),
          })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <code className="px-2 py-1 rounded bg-purple-500/20 border border-purple-500/35 text-purple-200 text-[11px] font-mono">
          {token}
        </code>
        {onInsertToken && (
          <button
            type="button"
            onClick={() => onInsertToken(token)}
            className="text-[10px] text-cyan-400 hover:text-cyan-300"
          >
            {t('dashboard.properties.insertIntoQuery')}
          </button>
        )}
      </div>
      {hasListSql && indexMode && (
        <p className="text-[10px] text-zinc-500">
          {t('dashboard.properties.groupSqlHint')}
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
  return <WidgetDataBindingSettings w={w} onUpdate={onUpdate} />;
}

function AlertRulesEditor({
  rules,
  onChange,
}: {
  rules: AlertRule[];
  onChange: (next: AlertRule[]) => void;
}) {
  const { t } = useTranslation();
  const add = () => onChange([...rules, createEmptyAlertRule()]);
  const remove = (idx: number) => onChange(rules.filter((_, i) => i !== idx));
  const patch = (idx: number, p: Partial<AlertRule>) =>
    onChange(rules.map((r, i) => (i === idx ? { ...r, ...p } : r)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-zinc-500 text-[10px] uppercase font-bold tracking-tight">{t('dashboard.properties.alertRules.title')}</label>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); add(); }}
          className="p-1 hover:bg-zinc-800 rounded text-cyan-500 transition-colors"
          title={t('dashboard.properties.alertRules.addTitle')}
        >
          <Plus size={14} />
        </button>
      </div>
      <p className="text-[10px] text-zinc-500 leading-relaxed">
        {t('dashboard.properties.alertRules.hint')}<strong className="text-zinc-400">{t('dashboard.properties.alertRules.hintMulti')}</strong>
      </p>
      {rules.length === 0 && (
        <p className="text-[10px] text-amber-500/90">{t('dashboard.properties.alertRules.empty')}</p>
      )}
      {rules.map((rule, i) => (
        <div key={rule.id} className="p-2.5 bg-zinc-800/40 rounded-md border border-zinc-700/50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-400">{t('dashboard.properties.alertRules.ruleN', { n: i + 1 })}</span>
            <button type="button" onClick={() => remove(i)} className="p-0.5 text-zinc-500 hover:text-red-400 transition-colors">
              <X size={12} />
            </button>
          </div>

          <Field label={t('dashboard.properties.alertRules.content')}>
            <textarea
              value={rule.content}
              onChange={e => patch(i, { content: e.target.value })}
              className={`${inputCls} h-12 resize-none`}
              placeholder={t('dashboard.properties.alertRules.contentPlaceholder')}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('dashboard.properties.textColor')}>
              <input type="color" value={rule.textColor} onChange={e => patch(i, { textColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" />
            </Field>
            <Field label={t('dashboard.properties.backgroundColor')}>
              <input type="color" value={hexFromRgba(rule.backgroundColor)} onChange={e => patch(i, { backgroundColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" />
            </Field>
          </div>
          <Field label={t('dashboard.properties.alertRules.borderColor')}>
            <input type="color" value={hexFromRgba(rule.borderColor)} onChange={e => patch(i, { borderColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" />
          </Field>
          <Field label={t('dashboard.properties.alertRules.displayMode')}>
            <select value={rule.displayMode} onChange={e => patch(i, { displayMode: e.target.value as AlertDisplayMode })} className={selectCls}>
              <option value="blink">{t('dashboard.properties.alertRules.blink')}</option>
              <option value="static">{t('dashboard.properties.alertRules.static')}</option>
            </select>
          </Field>

          <div className="pt-1 border-t border-zinc-700/50 space-y-2">
            <p className="text-[10px] font-bold text-emerald-500/90">{t('dashboard.properties.alertRules.startCondition')}</p>
            <Field label={t('dashboard.properties.alertRules.watchField')}>
              <input value={rule.startField} onChange={e => patch(i, { startField: e.target.value })} className={inputCls} placeholder="alert_message" />
            </Field>
            <Field label={t('dashboard.properties.alertRules.triggerMode')}>
              <select value={rule.startMode} onChange={e => patch(i, { startMode: e.target.value as AlertTriggerMode })} className={selectCls}>
                <option value="non-empty">{t('dashboard.properties.alertRules.nonEmpty')}</option>
                <option value="equals">{t('dashboard.properties.alertRules.equals')}</option>
                <option value="not-equals">{t('dashboard.properties.alertRules.notEquals')}</option>
              </select>
            </Field>
            {(rule.startMode === 'equals' || rule.startMode === 'not-equals') && (
              <Field label={t('dashboard.properties.alertRules.compareValue')}>
                <input value={rule.startValue ?? ''} onChange={e => patch(i, { startValue: e.target.value })} className={inputCls} />
              </Field>
            )}
          </div>

          <div className="pt-1 border-t border-zinc-700/50 space-y-2">
            <label className="flex items-center gap-2 text-[10px] text-zinc-400">
              <input type="checkbox" checked={rule.endEnabled} onChange={e => patch(i, { endEnabled: e.target.checked })} className="accent-cyan-500" />
              {t('dashboard.properties.alertRules.enableEnd')}
            </label>
            {rule.endEnabled && (
              <>
                <Field label={t('dashboard.properties.alertRules.endField')}>
                  <input value={rule.endField ?? ''} onChange={e => patch(i, { endField: e.target.value })} className={inputCls} placeholder="health_status" />
                </Field>
                <Field label={t('dashboard.properties.alertRules.endMode')}>
                  <select value={rule.endMode ?? 'non-empty'} onChange={e => patch(i, { endMode: e.target.value as AlertTriggerMode })} className={selectCls}>
                    <option value="non-empty">{t('dashboard.properties.alertRules.nonEmpty')}</option>
                    <option value="equals">{t('dashboard.properties.alertRules.equals')}</option>
                    <option value="not-equals">{t('dashboard.properties.alertRules.notEquals')}</option>
                  </select>
                </Field>
                {(rule.endMode === 'equals' || rule.endMode === 'not-equals' || !rule.endMode) && (
                  <Field label={t('dashboard.properties.alertRules.endCompareValue')}>
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
  const { t } = useTranslation();
  const addRule = () => onUpdate([...rules, { condition: 'gt', threshold: '0', textColor: '#ffffff', bgColor: '#ef4444', borderColor: '#ef4444' }]);
  const removeRule = (idx: number) => onUpdate(rules.filter((_, i) => i !== idx));
  const updateRule = (idx: number, patch: Partial<ColorRule>) => onUpdate(rules.map((r, i) => i === idx ? { ...r, ...patch } : r));

  return (
    <div className={`space-y-2 border-t border-zinc-800 pt-3 transition-opacity ${!enabled ? 'opacity-40' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={e => onToggleEnabled(e.target.checked)} className="accent-cyan-500 w-3 h-3 cursor-pointer" />
          <SH icon={<Palette size={12} />} label={t('dashboard.properties.colorRules.title')} color="#ec4899" />
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
              <option value="gt">{t('dashboard.properties.colorRules.opGt')}</option><option value="lt">{t('dashboard.properties.colorRules.opLt')}</option>
              <option value="eq">{t('dashboard.properties.colorRules.opEq')}</option><option value="contains">{t('dashboard.properties.colorRules.opContains')}</option>
              <option value="status_eq">{t('dashboard.properties.colorRules.opStatusEq')}</option>
            </select>
            <input value={rule.threshold} onChange={e => updateRule(i, { threshold: e.target.value })} className={`${inputCls} flex-1`} placeholder={t('dashboard.properties.colorRules.thresholdPlaceholder')} />
          </div>
          <div className="grid grid-cols-3 gap-1">
            <div className="flex items-center gap-1 bg-zinc-900/50 p-1 rounded border border-zinc-700/30">
              <input type="color" value={rule.textColor} onChange={e => updateRule(i, { textColor: e.target.value })} className="w-3.5 h-3.5 bg-transparent cursor-pointer" />
              <span className="text-[8px] text-zinc-500 uppercase">{t('dashboard.properties.colorRules.abbrText')}</span>
            </div>
            <div className="flex items-center gap-1 bg-zinc-900/50 p-1 rounded border border-zinc-700/30">
              <input type="color" value={rule.bgColor} onChange={e => updateRule(i, { bgColor: e.target.value })} className="w-3.5 h-3.5 bg-transparent cursor-pointer" />
              <span className="text-[8px] text-zinc-500 uppercase">{t('dashboard.properties.colorRules.abbrBg')}</span>
            </div>
            <div className="flex items-center gap-1 bg-zinc-900/50 p-1 rounded border border-zinc-700/30">
              <input type="color" value={rule.borderColor || '#ffffff'} onChange={e => updateRule(i, { borderColor: e.target.value })} className="w-3.5 h-3.5 bg-transparent cursor-pointer" />
              <span className="text-[8px] text-zinc-500 uppercase">{t('dashboard.properties.colorRules.abbrBorder')}</span>
            </div>
          </div>
        </div>
      ))}
      {rules.length === 0 && <div className="text-[10px] text-zinc-600 text-center py-2 italic">{t('dashboard.properties.colorRules.empty')}</div>}
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
  const { t } = useTranslation();
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
      <SH icon={<Type size={13} />} label={t('dashboard.properties.widgets.text.title')} color="#f59e0b" />
      
      <div className="space-y-3">
        <Field label={t('dashboard.properties.widgets.text.defaultContent')}>
          <textarea
            value={w.content}
            onChange={e => onUpdate({ content: e.target.value })}
            className={`${inputCls} h-16 resize-none`}
            placeholder={t('dashboard.properties.widgets.text.defaultPlaceholder')}
          />
          {(w.dataSourceId || w.mqttDataSourceId) && (
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              {t('dashboard.properties.widgets.text.defaultHint')}
            </p>
          )}
        </Field>
        
        <Field label={t('dashboard.properties.icon')}>
          <div className="space-y-2">
            <select value={w.icon || ''} onChange={e => onUpdate({ icon: e.target.value })} className={selectCls}>
              <option value="">{t('dashboard.properties.iconBuiltin')}</option>
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

        <Field label={t('dashboard.properties.iconImage')}>
          <IconImageField
            value={w.iconImage}
            onChange={(url) => onUpdate({ iconImage: url, icon: url ? undefined : w.icon })}
          />
        </Field>

        {(w.icon || w.iconImage) && (
          <Field label={t('dashboard.properties.iconGapPx')}>
            <NumberInput
              min={0}
              max={32}
              value={w.iconGap ?? (w.textWrap === 'nowrap' ? 4 : 8)}
              onChange={n => onUpdate({ iconGap: Math.max(0, n) })}
              className={inputCls}
            />
          </Field>
        )}
      </div>

      <div className="space-y-4 pt-4 border-t border-zinc-800">
        <SH icon={<Palette size={13} />} label={t('dashboard.properties.appearanceDefault')} color="#ec4899" />
        
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('dashboard.properties.textColor')}>
            <div className="flex gap-2">
              <input type="color" value={w.color.startsWith('#') ? w.color : '#ffffff'} onChange={e => onUpdate({ color: e.target.value })} className="w-8 h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" />
              <input value={w.color} onChange={e => onUpdate({ color: e.target.value })} className={`${inputCls} font-mono`} placeholder="#RRGGBB" />
            </div>
          </Field>
          <Field label={t('dashboard.properties.fontSize')}>
            <NumberInput value={w.fontSize} onChange={n => onUpdate({ fontSize: n })} className={inputCls} />
          </Field>
        </div>

        <Field label={t('dashboard.properties.align')}>
          <TextAlignmentControls
            horizontal={resolveTextHorizontalAlign(w.textAlign)}
            vertical={resolveTextVerticalAlign(w.verticalAlign)}
            onHorizontalChange={(textAlign) => onUpdate({ textAlign })}
            onVerticalChange={(verticalAlign) => onUpdate({ verticalAlign })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('dashboard.properties.backgroundFill')}>
            <div className="flex gap-2">
              <input type="color" value={w.backgroundColor?.startsWith('#') ? w.backgroundColor : '#000000'} onChange={e => onUpdate({ backgroundColor: e.target.value })} className="w-8 h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" />
              <button onClick={() => onUpdate({ backgroundColor: 'transparent' })} className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[9px] hover:bg-zinc-700 transition-colors">{t('dashboard.properties.transparent')}</button>
            </div>
          </Field>
          <Field label={t('dashboard.properties.borderRadius')}>
            <NumberInput min={0} value={w.borderRadius || 0} onChange={n => onUpdate({ borderRadius: n })} className={inputCls} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('dashboard.properties.borderColor')}>
            <div className="flex gap-2">
              <input type="color" value={w.borderColor?.startsWith('#') ? w.borderColor : '#ffffff'} onChange={e => onUpdate({ borderColor: e.target.value })} className="w-8 h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" />
              <button onClick={() => onUpdate({ borderColor: 'transparent' })} className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[9px] hover:bg-zinc-700 transition-colors">{t('dashboard.properties.transparent')}</button>
            </div>
          </Field>
          <Field label={t('dashboard.properties.borderWidth')}>
            <NumberInput min={0} value={w.borderWidth || 0} onChange={n => onUpdate({ borderWidth: n })} className={inputCls} />
          </Field>
        </div>
      </div>

      <div className="pt-4 border-t border-zinc-800">
        <SH icon={<Database size={13} />} label={t('dashboard.properties.dataBinding')} color="#a78bfa" />
        <div className="mt-3 space-y-3">
          <DataBindingSettings w={w} onUpdate={onUpdate} />
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
        {t('dashboard.properties.widgets.text.severityColor')}
      </label>
      <PositionFields widget={w} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function AlertBannerSettings({ w, onUpdate, onDelete }: { w: AlertBannerWidget; onUpdate: (p: Partial<AlertBannerWidget>) => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const rules = w.triggerConditions != null
    ? w.triggerConditions.map((r, i) => coerceAlertRule(r, i))
    : getEditorAlertRules(w);

  const setRules = (next: AlertRule[]) =>
    onUpdate({ triggerConditions: next, triggerField: undefined, triggerMode: undefined, triggerValue: undefined });

  return (
    <div className="space-y-5">
      <SH icon={<Database size={13} />} label={t('dashboard.properties.dataSource')} color="#a78bfa" />
      <DataBindingSettings w={w} onUpdate={onUpdate} />

      <div className="pt-2 border-t border-zinc-800 space-y-3">
        <SH icon={<AlertTriangle size={13} />} label={t('dashboard.properties.alertRules.title')} color="#f97316" />
        <div className="p-2.5 rounded-lg bg-amber-950/25 border border-amber-700/40 text-[10px] text-amber-200/90 leading-relaxed">
          {t('dashboard.properties.alertRules.previewHint')}
          {(w.alertPresentation ?? 'stack') === 'carousel'
            ? <> {t('dashboard.properties.alertRules.multiCarousel')}</>
            : <> {t('dashboard.properties.alertRules.multiStack')}</>}
        </div>
        <AlertRulesEditor rules={rules} onChange={setRules} />
      </div>

      <div className="pt-2 border-t border-zinc-800 space-y-3">
        <SH icon={<Type size={13} />} label={t('dashboard.properties.displayModeSection')} color="#38bdf8" />
        <Field label={t('dashboard.properties.alertRules.multiHit')}>
          <select
            value={w.alertPresentation ?? 'stack'}
            onChange={e => onUpdate({ alertPresentation: e.target.value as 'stack' | 'carousel' })}
            className={inputCls}
          >
            <option value="stack">{t('dashboard.properties.alertRules.stack')}</option>
            <option value="carousel">{t('dashboard.properties.alertRules.carousel')}</option>
          </select>
        </Field>
        {(w.alertPresentation ?? 'stack') === 'carousel' && (
          <Field label={t('dashboard.properties.alertRules.carouselMs')}>
            <NumberInput
              min={1200}
              step={100}
              value={w.carouselIntervalMs ?? 3200}
              onChange={n => onUpdate({ carouselIntervalMs: n })}
              className={inputCls}
            />
          </Field>
        )}
      </div>

      <div className="pt-2 border-t border-zinc-800 space-y-3">
        <SH icon={<Type size={13} />} label={t('dashboard.properties.sharedStyle')} color="#94a3b8" />
        <Field label={t('dashboard.properties.alertRules.fontSize')}>
          <NumberInput min={8} value={w.fontSize ?? 10} onChange={n => onUpdate({ fontSize: n })} className={inputCls} />
        </Field>
        <Field label={t('dashboard.properties.iconLucideOptional')}>
          <input value={w.icon ?? ''} onChange={e => onUpdate({ icon: e.target.value })} className={inputCls} placeholder="AlertCircle" />
        </Field>
      </div>

      <PositionFields widget={w} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function GaugeSettings({ w, onUpdate, onDelete }: { w: GaugeWidget; onUpdate: (p: Partial<GaugeWidget>) => void; onDelete: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <SH icon={<Gauge size={13} />} label={t('dashboard.properties.widgets.gauge.title')} color="#ec4899" />
      <Field label={t('dashboard.properties.title')}><input value={w.title} onChange={e => onUpdate({ title: e.target.value })} className={inputCls} /></Field>
      
      <DataBindingSettings w={w} onUpdate={onUpdate} />
      <Field label={t('dashboard.properties.valueField')}><input value={w.valueField} onChange={e => onUpdate({ valueField: e.target.value })} className={inputCls} placeholder="speed" /></Field>
      <Field label={t('dashboard.properties.style')}>
        <select
          value={w.gaugeVariant ?? 'default'}
          onChange={e => onUpdate({ gaugeVariant: e.target.value as GaugeWidget['gaugeVariant'] })}
          className={selectCls}
        >
          <option value="default">{t('dashboard.properties.widgets.gauge.variantDefault')}</option>
          <option value="semi-arc">{t('dashboard.properties.widgets.gauge.variantSemiArc')}</option>
          <option value="ring">{t('dashboard.properties.widgets.gauge.variantRing')}</option>
        </select>
      </Field>
      
      <div className="grid grid-cols-3 gap-1.5">
        <Field label={t('dashboard.properties.min')}><NumberInput value={w.min} onChange={n => onUpdate({ min: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.max')}><NumberInput value={w.max} onChange={n => onUpdate({ max: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.unit')}><input value={w.unit} onChange={e => onUpdate({ unit: e.target.value })} className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('dashboard.properties.widgets.gauge.valueFontSize')}>
          <NumberInput
            min={8}
            max={96}
            value={w.gaugeValueFontSize ?? 16}
            onChange={n => onUpdate({ gaugeValueFontSize: n })}
            className={inputCls}
          />
        </Field>
        <Field label={t('dashboard.properties.widgets.gauge.unitFontSize')}>
          <NumberInput
            min={7}
            max={48}
            value={w.gaugeUnitFontSize ?? 12}
            onChange={n => onUpdate({ gaugeUnitFontSize: n })}
            className={inputCls}
          />
        </Field>
      </div>
      <Field label={t('dashboard.properties.widgets.gauge.strokeWidth')}>
        <input
          type="number"
          min={1}
          max={32}
          value={w.gaugeArcStrokeWidth ?? ''}
          placeholder={w.gaugeVariant === 'semi-arc' ? t('dashboard.properties.auto') : '12'}
          onChange={e => {
            const v = e.target.value.trim();
            onUpdate({ gaugeArcStrokeWidth: v === '' ? undefined : Math.max(1, +v) });
          }}
          className={inputCls}
        />
        <p className="text-[10px] text-zinc-500 mt-1 leading-relaxed">
          {t('dashboard.properties.widgets.gauge.strokeHint')}
        </p>
      </Field>
      <div className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{t('dashboard.properties.paddingPx')}</div>
        <div className="grid grid-cols-4 gap-1.5">
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <Field key={side} label={side === 'top' ? t('dashboard.properties.sideTop') : side === 'right' ? t('dashboard.properties.sideRight') : side === 'bottom' ? t('dashboard.properties.sideBottom') : t('dashboard.properties.sideLeft')}>
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
          {t('dashboard.properties.widgets.gauge.padHint')}
        </p>
      </div>
      <Field label={t('dashboard.properties.widgets.gauge.textGap')}>
        <NumberInput
          min={-24}
          max={48}
          value={w.gaugeTextGap ?? 0}
          onChange={n => onUpdate({ gaugeTextGap: n })}
          className={inputCls}
        />
        <p className="text-[10px] text-zinc-500 mt-1 leading-relaxed">
          {t('dashboard.properties.widgets.gauge.textGapHint')}
        </p>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('dashboard.properties.widgets.gauge.panelBg')}>
          <input
            type="color"
            value={w.panelBackgroundColor?.startsWith('#') ? w.panelBackgroundColor : '#1a2332'}
            onChange={e => onUpdate({ panelBackgroundColor: e.target.value })}
            className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer"
          />
        </Field>
        <Field label={t('dashboard.properties.widgets.gauge.panelRadius')}>
          <NumberInput
            min={0}
            value={w.panelBorderRadius ?? 6}
            onChange={n => onUpdate({ panelBorderRadius: n })}
            className={inputCls}
          />
        </Field>
      </div>
      <button
        type="button"
        className="text-xs text-zinc-400 hover:text-zinc-200 underline"
        onClick={() => onUpdate({ panelBackgroundColor: 'transparent', panelBorderRadius: 0 })}
      >
        {t('dashboard.properties.widgets.gauge.panelTransparent')}
      </button>

      <PositionFields widget={w} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function SegmentBarSettings({ w, onUpdate, onDelete }: { w: SegmentBarWidget; onUpdate: (p: Partial<SegmentBarWidget>) => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const rules = w.colorRules ?? [];
  const patchRule = (idx: number, patch: Partial<SegmentBarColorRule>) => {
    const next = rules.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onUpdate({ colorRules: next });
  };
  return (
    <div className="space-y-4">
      <SH icon={<BarChart2 size={13} />} label={t('dashboard.properties.widgets.segmentBar.title')} color="#22c55e" />
      <Field label={t('dashboard.properties.title')}><input value={w.title ?? ''} onChange={e => onUpdate({ title: e.target.value })} className={inputCls} /></Field>
      <Field label={t('dashboard.properties.widgets.segmentBar.titleIcon')}>
        <IconImageField
          value={w.titleIconImage}
          onChange={(url) => onUpdate({ titleIconImage: url })}
        />
      </Field>
      <DataBindingSettings w={w} onUpdate={onUpdate} />
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('dashboard.properties.statusField')}><input value={w.statusField} onChange={e => onUpdate({ statusField: e.target.value })} className={inputCls} placeholder="status_code" /></Field>
        <Field label={t('dashboard.properties.widgets.segmentBar.pctField')}><input value={w.pctField} onChange={e => onUpdate({ pctField: e.target.value })} className={inputCls} placeholder="pct" /></Field>
        <Field label={t('dashboard.properties.widgets.segmentBar.countField')}><input value={w.countField} onChange={e => onUpdate({ countField: e.target.value })} className={inputCls} placeholder="vehicle_count" /></Field>
        <Field label={t('dashboard.properties.widgets.segmentBar.countUnit')}><input value={w.countUnit ?? t('dashboard.properties.widgets.segmentBar.countUnitDefault')} onChange={e => onUpdate({ countUnit: e.target.value })} className={inputCls} /></Field>
      </div>
      <label className="flex items-center gap-2 text-[10px] text-zinc-400">
        <input type="checkbox" checked={w.showLegend !== false} onChange={e => onUpdate({ showLegend: e.target.checked })} />
        {t('dashboard.properties.showLegend')}
      </label>
      <p className="text-[10px] text-zinc-500">{t('dashboard.properties.widgets.segmentBar.statusLegend')}</p>
      {rules.map((rule, idx) => (
        <div key={idx} className="grid grid-cols-2 gap-2 rounded border border-zinc-800 p-2">
          <Field label={t('dashboard.properties.widgets.segmentBar.statusCode')}><input value={rule.status} onChange={e => patchRule(idx, { status: e.target.value })} className={inputCls} /></Field>
          <Field label={t('dashboard.properties.label')}><input value={rule.label} onChange={e => patchRule(idx, { label: e.target.value })} className={inputCls} /></Field>
          <div className="col-span-2">
            <Field label={t('dashboard.properties.color')}>
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
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <SH icon={<LayoutGrid size={13} />} label={t('dashboard.properties.widgets.slotGrid.title')} color="#f43f5e" />
      <Field label={t('dashboard.properties.title')}><input value={w.title} onChange={e => onUpdate({ title: e.target.value })} className={inputCls} /></Field>
      
      <DataBindingSettings w={w} onUpdate={onUpdate} />
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('dashboard.properties.widgets.slotGrid.nameField')}><input value={w.nameField} onChange={e => onUpdate({ nameField: e.target.value })} className={inputCls} placeholder="slot_label" /></Field>
        <Field label={t('dashboard.properties.statusField')}><input value={w.statusField} onChange={e => onUpdate({ statusField: e.target.value })} className={inputCls} placeholder="status" /></Field>
      </div>
      <Field label={t('dashboard.properties.widgets.slotGrid.activeValues')}><input value={w.activeValues.join(',')} onChange={e => onUpdate({ activeValues: e.target.value.split(',').map(s => s.trim()) })} className={inputCls} placeholder="OCCUPIED,CHARGING" /></Field>
      <Field label={t('dashboard.properties.variant')}>
        <select value={w.variant ?? 'default'} onChange={e => onUpdate({ variant: e.target.value as SlotGridWidget['variant'] })} className={selectCls}>
          <option value="default">{t('dashboard.properties.widgets.slotGrid.variantDefault')}</option>
          <option value="compact-row">{t('dashboard.properties.widgets.slotGrid.variantCompact')}</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('dashboard.properties.widgets.slotGrid.activeColor')}><input type="color" value={w.activeColor} onChange={e => onUpdate({ activeColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
        <Field label={t('dashboard.properties.widgets.slotGrid.inactiveColor')}><input type="color" value={w.inactiveColor} onChange={e => onUpdate({ inactiveColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
        <Field label={t('dashboard.properties.widgets.slotGrid.layoutMode')}>
          <select value={w.layout} onChange={e => onUpdate({ layout: e.target.value as any })} className={selectCls}>
            <option value="horizontal">{t('dashboard.properties.widgets.slotGrid.layoutHorizontal')}</option><option value="grid">{t('dashboard.properties.widgets.slotGrid.layoutGrid')}</option>
          </select>
        </Field>
        <Field label={t('dashboard.properties.widgets.slotGrid.slotGap')}><NumberInput min={0} value={w.slotGap ?? 4} onChange={n => onUpdate({ slotGap: n })} className={inputCls} /></Field>
      </div>
      <p className="text-[10px] text-zinc-500 leading-relaxed">
        {t('dashboard.properties.widgets.slotGrid.hint')}
      </p>

      <PositionFields widget={w} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function MaintenanceDistributionSettings({ w, onUpdate, onDelete }: { w: MaintenanceDistributionWidget; onUpdate: (p: Partial<MaintenanceDistributionWidget>) => void; onDelete: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <SH icon={<LayoutGrid size={13} />} label={t('dashboard.properties.widgets.maintenanceDistribution.title')} color="#f43f5e" />
      <Field label={t('dashboard.properties.title')}><input value={w.title} onChange={e => onUpdate({ title: e.target.value })} className={inputCls} /></Field>
      <Field label={t('dashboard.properties.widgets.maintenanceDistribution.dataUrl')}>
        <input value={w.dataUrl ?? ''} onChange={e => onUpdate({ dataUrl: e.target.value })} className={inputCls} placeholder="/syncdrive-api/facility/maintenance-distribution" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('dashboard.properties.widgets.maintenanceDistribution.columns')}><NumberInput min={1} max={4} value={w.columns ?? 2} onChange={n => onUpdate({ columns: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.widgets.maintenanceDistribution.slotFontSize')}><NumberInput min={8} value={w.slotFontSize ?? 14} onChange={n => onUpdate({ slotFontSize: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.widgets.maintenanceDistribution.titleFontSize')}><NumberInput min={8} value={w.titleFontSize ?? 16} onChange={n => onUpdate({ titleFontSize: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.widgets.maintenanceDistribution.cardTitleFontSize')}><NumberInput min={8} value={w.cardTitleFontSize ?? 16} onChange={n => onUpdate({ cardTitleFontSize: n })} className={inputCls} /></Field>
      </div>
      <p className="text-[10px] text-zinc-500 leading-relaxed">
        {t('dashboard.properties.widgets.maintenanceDistribution.hint')}
      </p>

      <PositionFields widget={w} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

// ─── (舊有元件保持簡化) ──────────────────────────────────────────────

function ImageSettings({ w, onUpdate, onDelete }: { w: ImageWidget; onUpdate: (p: Partial<ImageWidget>) => void; onDelete: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <SH icon={<Image size={13} />} label={t('dashboard.properties.widgets.image.title')} color="#10b981" />

      {/* 圖片 URL */}
      <Field label={t('dashboard.properties.widgets.image.url')}>
        <input
          value={w.src}
          onChange={e => onUpdate({ src: e.target.value })}
          className={inputCls}
          placeholder="https://example.com/photo.jpg"
        />
      </Field>
      {w.src?.trim() && (
        <div className="rounded-lg overflow-hidden border border-zinc-700 bg-zinc-900">
          <img
            src={w.src}
            alt={t('dashboard.properties.preview')}
            className="w-full max-h-28 object-contain"
            onError={e => { (e.currentTarget as HTMLImageElement).style.opacity = '0.25'; }}
          />
        </div>
      )}

      {/* 圖片填充模式 */}
      <Field label={t('dashboard.properties.widgets.image.objectFit')}>
        <select
          value={w.objectFit}
          onChange={e => onUpdate({ objectFit: e.target.value as ImageWidget['objectFit'] })}
          className={selectCls}
        >
          <option value="cover">{t('dashboard.properties.widgets.image.fitCover')}</option>
          <option value="contain">{t('dashboard.properties.widgets.image.fitContain')}</option>
          <option value="fill">{t('dashboard.properties.widgets.image.fitFill')}</option>
          <option value="none">{t('dashboard.properties.widgets.image.fitNone')}</option>
        </select>
      </Field>

      {/* 圓角與透明度 */}
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('dashboard.properties.borderRadiusPx')}>
          <NumberInput min={0} max={999}
            value={w.borderRadius}
            onChange={n => onUpdate({ borderRadius: n })}
            className={inputCls}
          />
        </Field>
        <Field label={t('dashboard.properties.opacityPct')}>
          <NumberInput min={0} max={100}
            value={w.opacity ?? 100}
            onChange={n => onUpdate({ opacity: n })}
            className={inputCls}
          />
        </Field>
      </div>

      {/* 背景色 */}
      <Field label={t('dashboard.properties.backgroundColorShort')}>
        <div className="flex gap-2 items-center">
          <input
            type="color"
            value={w.backgroundColor ?? '#000000'}
            onChange={e => onUpdate({ backgroundColor: e.target.value })}
            className="w-8 h-7 rounded border border-zinc-600 cursor-pointer bg-transparent"
          />
          <input
            value={w.backgroundColor ?? ''}
            onChange={e => onUpdate({ backgroundColor: e.target.value })}
            className={inputCls}
            placeholder="transparent"
          />
        </div>
      </Field>

      {/* 外框 */}
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('dashboard.properties.borderWidthPx')}>
          <NumberInput min={0} max={20}
            value={w.borderWidth ?? 0}
            onChange={n => onUpdate({ borderWidth: n })}
            className={inputCls}
          />
        </Field>
        <Field label={t('dashboard.properties.borderColor')}>
          <div className="flex gap-1 items-center">
            <input
              type="color"
              value={w.borderColor ?? '#ffffff'}
              onChange={e => onUpdate({ borderColor: e.target.value })}
              className="w-8 h-7 rounded border border-zinc-600 cursor-pointer bg-transparent"
            />
            <input
              value={w.borderColor ?? ''}
              onChange={e => onUpdate({ borderColor: e.target.value })}
              className={inputCls}
              placeholder="rgba(255,255,255,0.15)"
            />
          </div>
        </Field>
      </div>

      {/* ── 疊加文字 ── */}
      <SH icon={<Type size={13} />} label={t('dashboard.properties.widgets.image.overlay')} color="#a78bfa" />

      <Field label={t('dashboard.properties.widgets.image.overlayContent')}>
        <textarea
          rows={2}
          value={w.overlayText ?? ''}
          onChange={e => onUpdate({ overlayText: e.target.value })}
          className={`${inputCls} resize-none`}
          placeholder={t('dashboard.properties.widgets.image.overlayPlaceholder')}
        />
      </Field>

      {(w.overlayText ?? '').trim() !== '' && (
        <>
          <Field label={t('dashboard.properties.widgets.image.textPosition')}>
            <select
              value={w.overlayPosition ?? 'bottom-left'}
              onChange={e => onUpdate({ overlayPosition: e.target.value as ImageWidget['overlayPosition'] })}
              className={selectCls}
            >
              <option value="top-left">{t('dashboard.properties.widgets.image.posTopLeft')}</option>
              <option value="top-center">{t('dashboard.properties.widgets.image.posTopCenter')}</option>
              <option value="top-right">{t('dashboard.properties.widgets.image.posTopRight')}</option>
              <option value="center">{t('dashboard.properties.widgets.image.posCenter')}</option>
              <option value="bottom-left">{t('dashboard.properties.widgets.image.posBottomLeft')}</option>
              <option value="bottom-center">{t('dashboard.properties.widgets.image.posBottomCenter')}</option>
              <option value="bottom-right">{t('dashboard.properties.widgets.image.posBottomRight')}</option>
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label={t('dashboard.properties.fontSizePx')}>
              <NumberInput min={8} max={72}
                value={w.overlayFontSize ?? 13}
                onChange={n => onUpdate({ overlayFontSize: n })}
                className={inputCls}
              />
            </Field>
            <Field label={t('dashboard.properties.fontWeight')}>
              <select
                value={w.overlayFontWeight ?? 'normal'}
                onChange={e => onUpdate({ overlayFontWeight: e.target.value as 'normal' | 'bold' })}
                className={selectCls}
              >
                <option value="normal">{t('dashboard.properties.normal')}</option>
                <option value="bold">{t('dashboard.properties.boldWeight')}</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label={t('dashboard.properties.textColor')}>
              <div className="flex gap-1 items-center">
                <input
                  type="color"
                  value={w.overlayTextColor ?? '#ffffff'}
                  onChange={e => onUpdate({ overlayTextColor: e.target.value })}
                  className="w-8 h-7 rounded border border-zinc-600 cursor-pointer bg-transparent"
                />
                <input
                  value={w.overlayTextColor ?? '#ffffff'}
                  onChange={e => onUpdate({ overlayTextColor: e.target.value })}
                  className={inputCls}
                />
              </div>
            </Field>
            <Field label={t('dashboard.properties.widgets.image.textBg')}>
              <div className="flex gap-1 items-center">
                <input
                  type="color"
                  value={w.overlayBgColor ?? '#000000'}
                  onChange={e => onUpdate({ overlayBgColor: e.target.value })}
                  className="w-8 h-7 rounded border border-zinc-600 cursor-pointer bg-transparent"
                />
                <input
                  value={w.overlayBgColor ?? 'rgba(0,0,0,0.45)'}
                  onChange={e => onUpdate({ overlayBgColor: e.target.value })}
                  className={inputCls}
                  placeholder="rgba(0,0,0,0.45)"
                />
              </div>
            </Field>
          </div>
        </>
      )}

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
  const { t } = useTranslation();
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
        <Field label={t('dashboard.properties.unit')}>
          <select value={unit} onChange={e => patch({ unit: e.target.value as ChartAxisUnit })} className={selectCls}>
            <option value="number">{t('dashboard.properties.widgets.chart.unitNumber')}</option>
            <option value="time">{t('dashboard.properties.widgets.chart.unitTime')}</option>
          </select>
        </Field>
        <Field label={t('dashboard.properties.widgets.chart.axisLabel')}>
          <input value={axis?.label ?? ''} onChange={e => patch({ label: e.target.value })} className={inputCls} placeholder={t('dashboard.properties.optionalShort')} />
        </Field>
        <Field label={t('dashboard.properties.widgets.chart.axisMin')}>{boundInput('min', unit === 'time' ? '07:00' : '0')}</Field>
        <Field label={t('dashboard.properties.widgets.chart.axisMax')}>{boundInput('max', unit === 'time' ? '12:00' : '100')}</Field>
        {unit === 'time' && (
          <>
            <Field label={t('dashboard.properties.widgets.chart.timeFormat')}>
              <select value={axis?.timeStyle ?? 'hm'} onChange={e => patch({ timeStyle: e.target.value as 'hm' })} className={selectCls}>
                <option value="hm">{t('dashboard.properties.widgets.chart.timeHm')}</option>
              </select>
            </Field>
            <Field label={t('dashboard.properties.widgets.chart.clockSystem')}>
              <select value={axis?.timeClock ?? '24h'} onChange={e => patch({ timeClock: e.target.value as '12h' | '24h' })} className={selectCls}>
                <option value="24h">{t('dashboard.properties.widgets.chart.h24')}</option>
                <option value="12h">{t('dashboard.properties.widgets.chart.h12')}</option>
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
                {t('dashboard.properties.widgets.chart.syncNow')}
              </label>
              {axis?.timeWindow?.enabled === true && (
                <div className="grid grid-cols-3 gap-2">
                  <Field label={t('dashboard.properties.widgets.chart.pastRatio')}>
                    <NumberInput
                      min={1}
                      value={axis?.timeWindow?.pastRatio ?? 2}
                      onChange={n =>
                        patch({
                          timeWindow: { ...axis?.timeWindow, enabled: true, pastRatio: n },
                        })
                      }
                      className={inputCls}
                    />
                  </Field>
                  <Field label={t('dashboard.properties.widgets.chart.futureRatio')}>
                    <NumberInput
                      min={1}
                      value={axis?.timeWindow?.futureRatio ?? 4}
                      onChange={n =>
                        patch({
                          timeWindow: { ...axis?.timeWindow, enabled: true, futureRatio: n },
                        })
                      }
                      className={inputCls}
                    />
                  </Field>
                  <Field label={t('dashboard.properties.widgets.chart.windowMin')}>
                    <NumberInput
                      min={60}
                      value={axis?.timeWindow?.totalMinutes ?? 360}
                      onChange={n =>
                        patch({
                          timeWindow: { ...axis?.timeWindow, enabled: true, totalMinutes: n },
                        })
                      }
                      className={inputCls}
                    />
                  </Field>
                </div>
              )}
              {axis?.timeWindow?.enabled !== true && (
                <Field label={t('dashboard.properties.widgets.chart.highlightTime')}>
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
  const { t } = useTranslation();
  const patch = (p: Partial<LineChartSeriesConfig>) => onChange({ ...series, ...p });
  const patchLabelStyle = (p: Partial<LineChartEventLabelStyle>) =>
    patch({ eventLabelStyle: { ...series.eventLabelStyle, ...p } });

  return (
    <div className="space-y-2 rounded-lg border border-zinc-800/80 p-2.5 bg-zinc-900/30 relative group">
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-2 right-2 p-1 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 rounded opacity-0 group-hover:opacity-100"
        title={t('dashboard.properties.widgets.chart.removeSeries')}
      >
        <X size={12} />
      </button>
      <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide pr-6">{t('dashboard.properties.widgets.chart.seriesTitle')}</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('dashboard.properties.widgets.chart.yField')}>
          <input value={series.yField} onChange={e => patch({ yField: e.target.value })} className={inputCls} placeholder="actual_util" />
        </Field>
        <Field label={t('dashboard.properties.widgets.chart.lineColor')}>
          <input
            type="color"
            value={series.color?.startsWith('#') ? series.color : '#38bdf8'}
            onChange={e => patch({ color: e.target.value })}
            className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer"
          />
        </Field>
        <Field label={t('dashboard.properties.widgets.chart.legendName')}>
          <input
            value={series.label ?? ''}
            onChange={e => patch({ label: e.target.value || undefined })}
            className={inputCls}
            placeholder={t('dashboard.properties.optionalShort')}
          />
        </Field>
        <Field label={t('dashboard.properties.widgets.chart.lineWidth')}>
          <NumberInput
            min={1}
            max={8}
            value={series.strokeWidth ?? 2}
            onChange={n => patch({ strokeWidth: n })}
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
          {t('dashboard.properties.widgets.chart.eventLabels')}
        </label>
        {series.eventLabelsEnabled === true && (
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('dashboard.properties.widgets.chart.labelField')}>
              <input
                value={series.eventLabelField ?? ''}
                onChange={e => patch({ eventLabelField: e.target.value || undefined })}
                className={inputCls}
                placeholder="anomaly_label"
              />
            </Field>
            <Field label={t('dashboard.properties.widgets.chart.flagField')}>
              <input
                value={series.eventFlagField ?? ''}
                onChange={e => patch({ eventFlagField: e.target.value || undefined })}
                className={inputCls}
                placeholder="is_anomaly"
              />
            </Field>
            <Field label={t('dashboard.properties.fontSizePx')}>
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
            <Field label={t('dashboard.properties.fontWeight')}>
              <select
                value={String(series.eventLabelStyle?.fontWeight ?? 'normal')}
                onChange={e =>
                  patchLabelStyle({
                    fontWeight: e.target.value === 'bold' ? 'bold' : 'normal',
                  })
                }
                className={selectCls}
              >
                <option value="normal">{t('dashboard.properties.normal')}</option>
                <option value="bold">{t('dashboard.properties.boldWeight')}</option>
              </select>
            </Field>
            <Field label={t('dashboard.properties.widgets.chart.textColorShort')}>
              <input
                type="color"
                value={series.eventLabelStyle?.fill?.startsWith('#') ? series.eventLabelStyle.fill : '#fca5a5'}
                onChange={e => patchLabelStyle({ fill: e.target.value })}
                className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer"
              />
            </Field>
            <Field label={t('dashboard.properties.widgets.chart.borderColorShort')}>
              <input
                type="color"
                value={series.eventLabelStyle?.stroke?.startsWith('#') ? series.eventLabelStyle.stroke : '#ef4444'}
                onChange={e => patchLabelStyle({ stroke: e.target.value })}
                className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer"
              />
            </Field>
            <Field label={t('dashboard.properties.borderWidth')}>
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
  const { t } = useTranslation();
  const patch = (p: Partial<ChartAxisBandConfig>) => onChange({ ...band, ...p });
  const rules = band.colorRules ?? [];
  const addRule = () => patch({ colorRules: [...rules, { value: '', color: '#64748b' }] });
  const removeRule = (idx: number) => patch({ colorRules: rules.filter((_, i) => i !== idx) });
  const updateRule = (idx: number, p: Partial<ChartAxisBandColorRule>) =>
    patch({ colorRules: rules.map((r, i) => (i === idx ? { ...r, ...p } : r)) });

  return (
    <div className="space-y-2 rounded-lg border border-zinc-800/80 p-2.5 bg-zinc-900/30">
      <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">{t('dashboard.properties.widgets.chart.bandTitle', { axis: band.axis.toUpperCase() })}</p>
      <p className="text-[10px] text-zinc-500 leading-relaxed">
        {t('dashboard.properties.widgets.chart.bandHint')}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('dashboard.properties.widgets.chart.startField')}>
          <input value={band.startField ?? ''} onChange={e => patch({ startField: e.target.value || undefined })} className={inputCls} placeholder={band.axis === 'x' ? 'time' : 'value'} />
        </Field>
        <Field label={t('dashboard.properties.widgets.chart.endField')}>
          <input value={band.endField ?? ''} onChange={e => patch({ endField: e.target.value || undefined })} className={inputCls} placeholder={t('dashboard.properties.widgets.chart.endFieldPlaceholder')} />
        </Field>
        <Field label={t('dashboard.properties.widgets.chart.segmentIdField')}>
          <input value={band.segmentField} onChange={e => patch({ segmentField: e.target.value })} className={inputCls} placeholder="segment_code" />
        </Field>
        <Field label={t('dashboard.properties.widgets.chart.defaultColor')}>
          <input type="color" value={band.defaultColor?.startsWith('#') ? band.defaultColor : '#64748b'} onChange={e => patch({ defaultColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" />
        </Field>
        <Field label={t('dashboard.properties.widgets.chart.thickness')}>
          <NumberInput min={1} max={20} value={band.thickness ?? 4} onChange={n => patch({ thickness: n })} className={inputCls} />
        </Field>
        <Field label={t('dashboard.properties.opacity01')}>
          <NumberInput min={0} max={1} step={0.1} value={band.opacity ?? 1} onChange={n => patch({ opacity: n })} className={inputCls} />
        </Field>
      </div>
      <div className="space-y-1.5 pt-1 border-t border-zinc-800">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500 font-bold uppercase">{t('dashboard.properties.widgets.chart.valueColorMap')}</span>
          <button type="button" onClick={addRule} className="p-1 text-cyan-500 hover:bg-zinc-800 rounded"><Plus size={12} /></button>
        </div>
        {rules.map((rule, i) => (
          <div key={i} className="flex items-center gap-1.5 p-1.5 bg-zinc-800/40 rounded border border-zinc-700/50 relative group">
            <button type="button" onClick={() => removeRule(i)} className="absolute -top-1.5 -right-1.5 p-0.5 bg-zinc-700 rounded-full text-zinc-400 hover:text-white opacity-0 group-hover:opacity-100"><X size={10} /></button>
            <input value={rule.value} onChange={e => updateRule(i, { value: e.target.value })} className={`${inputCls} flex-1 font-mono`} placeholder="IN_SERVICE" />
            <input type="color" value={rule.color.startsWith('#') ? rule.color : '#64748b'} onChange={e => updateRule(i, { color: e.target.value })} className="w-8 h-8 rounded border border-zinc-700 bg-transparent cursor-pointer shrink-0" />
          </div>
        ))}
        {rules.length === 0 && <p className="text-[10px] text-zinc-600 italic text-center py-1">{t('dashboard.properties.widgets.chart.noMapping')}</p>}
      </div>
    </div>
  );
}

function LineChartSettings({ w, onUpdate, onDelete }: { w: LineChartWidget; onUpdate: (p: Partial<LineChartWidget>) => void; onDelete: () => void }) {
  const { t } = useTranslation();
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
      <SH icon={<TrendingUp size={13} />} label={t('dashboard.properties.widgets.chart.lineChartTitle')} color="#06b6d4" />
      <Field label={t('dashboard.properties.title')}><input value={w.title} onChange={e => onUpdate({ title: e.target.value })} className={inputCls} /></Field>
      <DataBindingSettings w={w} onUpdate={onUpdate} />
      <div className="space-y-2 pt-2 border-t border-zinc-800">
        <SH icon={<TrendingUp size={12} />} label={t('dashboard.properties.widgets.chart.paddingTitle')} color="#64748b" />
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          {t('dashboard.properties.widgets.chart.paddingHint')}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('dashboard.properties.sideTop')}><input type="number" min={0} max={120} value={w.chartPadding?.top ?? ''} placeholder="16" onChange={e => onUpdate({ chartPadding: { ...w.chartPadding, top: e.target.value === '' ? undefined : +e.target.value } })} className={inputCls} /></Field>
          <Field label={t('dashboard.properties.sideRight')}><input type="number" min={0} max={120} value={w.chartPadding?.right ?? ''} placeholder="16" onChange={e => onUpdate({ chartPadding: { ...w.chartPadding, right: e.target.value === '' ? undefined : +e.target.value } })} className={inputCls} /></Field>
          <Field label={t('dashboard.properties.sideBottom')}><input type="number" min={0} max={120} value={w.chartPadding?.bottom ?? ''} placeholder="36" onChange={e => onUpdate({ chartPadding: { ...w.chartPadding, bottom: e.target.value === '' ? undefined : +e.target.value } })} className={inputCls} /></Field>
          <Field label={t('dashboard.properties.sideLeft')}><input type="number" min={0} max={120} value={w.chartPadding?.left ?? ''} placeholder="48" onChange={e => onUpdate({ chartPadding: { ...w.chartPadding, left: e.target.value === '' ? undefined : +e.target.value } })} className={inputCls} /></Field>
        </div>
      </div>
      <Field label={t('dashboard.properties.widgets.chart.xField')}><input value={w.xField} onChange={e => onUpdate({ xField: e.target.value })} className={inputCls} /></Field>
      <div className="space-y-2 pt-2 border-t border-zinc-800">
        <div className="flex items-center justify-between">
          <SH icon={<TrendingUp size={12} />} label={t('dashboard.properties.widgets.chart.seriesSection')} color="#06b6d4" />
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
            <Plus size={12} /> {t('dashboard.properties.add')}
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
        <SH icon={<TrendingUp size={12} />} label={t('dashboard.properties.widgets.chart.axesSection')} color="#22d3ee" />
        <Field label={t('dashboard.properties.widgets.chart.viewportMode')}>
          <select
            value={w.viewportMode ?? 'fixed-axis'}
            onChange={e => onUpdate({ viewportMode: e.target.value as ChartViewportMode })}
            className={selectCls}
          >
            <option value="fixed-axis">{t('dashboard.properties.widgets.chart.viewportFixed')}</option>
            <option value="data-centered">{t('dashboard.properties.widgets.chart.viewportData')}</option>
          </select>
        </Field>
        {w.viewportMode === 'data-centered' && (
          <Field label={t('dashboard.properties.widgets.chart.viewportPad')}>
            <NumberInput
              min={0}
              max={45}
              value={Math.round((w.viewportPadding ?? 0.12) * 100)}
              onChange={n => onUpdate({ viewportPadding: Math.min(0.45, Math.max(0, n / 100)) })}
              className={inputCls}
            />
          </Field>
        )}
        <ChartAxisFields label={t('dashboard.properties.widgets.chart.xAxis')} axis={w.xAxis} onChange={xAxis => onUpdate({ xAxis })} />
        <ChartAxisFields label={t('dashboard.properties.widgets.chart.yAxis')} axis={w.yAxis} onChange={yAxis => onUpdate({ yAxis })} />
        <div className="space-y-2 rounded-lg border border-zinc-800/80 p-2.5 bg-zinc-900/30">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">{t('dashboard.properties.widgets.chart.bandsSection')}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input type="checkbox" checked={!!xBand} onChange={e => setBand('x', e.target.checked)} />
              {t('dashboard.properties.widgets.chart.enableXBand')}
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input type="checkbox" checked={!!yBand} onChange={e => setBand('y', e.target.checked)} />
              {t('dashboard.properties.widgets.chart.enableYBand')}
            </label>
          </div>
        </div>
        {xBand && <AxisBandFields band={xBand} onChange={b => updateBand('x', b)} />}
        {yBand && <AxisBandFields band={yBand} onChange={b => updateBand('y', b)} />}
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          {t('dashboard.properties.widgets.chart.axisHint')}
        </p>
      </div>
      <PositionFields widget={w} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function DatabaseSettings({ w, onUpdate, onDelete }: { w: DatabaseWidget; onUpdate: (p: Partial<DatabaseWidget>) => void; onDelete: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <SH icon={<Database size={13} />} label={t('dashboard.properties.widgets.database.title')} color="#a78bfa" />
      <Field label={t('dashboard.properties.title')}><input value={w.title} onChange={e => onUpdate({ title: e.target.value })} className={inputCls} /></Field>
      <DataBindingSettings w={w} onUpdate={onUpdate} />
      <Field label={t('dashboard.properties.widgets.database.maxRows')}><NumberInput value={w.maxRows} onChange={n => onUpdate({ maxRows: n })} className={inputCls} /></Field>
      <PositionFields widget={w} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

// ─── 平面與畫布設定 (保持) ───────────────────────────────────────────

function PlaneSettings({ plane, onUpdate, onDelete }: {
  plane: DashboardPlane;
  onUpdate: (p: Partial<Pick<DashboardPlane, 'name' | 'width' | 'height' | 'viewportMode'>>) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const g = gcd(plane.width, plane.height);
  const currentMode = plane.viewportMode ?? 'fixed-scale';
  return (
    <div className="space-y-6">
      <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-4 mb-2">
        <SH icon={<Settings size={14} className="text-cyan-400" />} label={t('dashboard.properties.plane.title')} color="#22d3ee" />
        <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-tighter">{t('dashboard.properties.plane.subtitle')}</p>
      </div>

      <div className="space-y-4 px-1">
        <Field label={t('dashboard.properties.plane.name')}>
          <input 
            value={plane.name} 
            onChange={e => onUpdate({ name: e.target.value })} 
            className={`${inputCls} text-sm font-semibold`} 
            placeholder={t('dashboard.properties.plane.namePlaceholder')}
          />
        </Field>

        <div className="space-y-1.5">
          <label className="text-zinc-400 text-xs font-medium block">{t('dashboard.properties.plane.viewportMode')}</label>
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-zinc-800/60 rounded-lg border border-zinc-700/50">
            <button
              type="button"
              onClick={() => onUpdate({ viewportMode: 'fixed-scale' })}
              className={`py-2 px-2 rounded-md text-[11px] font-medium flex flex-col items-center gap-1 transition-all ${
                currentMode === 'fixed-scale'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
              }`}
              title={t('dashboard.properties.plane.fixedScaleTitle')}
            >
              <span className="font-bold">{t('dashboard.properties.plane.fixedScale')}</span>
              <span className="text-[9px] opacity-75">{t('dashboard.properties.plane.fixedScaleSub')}</span>
            </button>
            <button
              type="button"
              onClick={() => onUpdate({ viewportMode: 'fit-width' })}
              className={`py-2 px-2 rounded-md text-[11px] font-medium flex flex-col items-center gap-1 transition-all ${
                currentMode === 'fit-width'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
              }`}
              title={t('dashboard.properties.plane.fitWidthTitle')}
            >
              <span className="font-bold">{t('dashboard.properties.plane.fitWidth')}</span>
              <span className="text-[9px] opacity-75">{t('dashboard.properties.plane.fitWidthSub')}</span>
            </button>
          </div>
          <p className="text-[10px] text-zinc-500 leading-relaxed px-0.5">
            {currentMode === 'fixed-scale'
              ? t('dashboard.properties.plane.fixedScaleHint')
              : t('dashboard.properties.plane.fitWidthHint')}
          </p>
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('dashboard.properties.plane.canvasWidth')}>
            <div className="relative">
              <NumberInput min={320} value={plane.width} onChange={n => onUpdate({ width: n })} className={inputCls} />
              <span className="absolute right-2 top-1.5 text-[9px] text-zinc-600 font-mono">PX</span>
            </div>
          </Field>
          <Field label={t('dashboard.properties.plane.canvasHeight')}>
            <div className="relative">
              <NumberInput min={240} value={plane.height} onChange={n => onUpdate({ height: n })} className={inputCls} />
              <span className="absolute right-2 top-1.5 text-[9px] text-zinc-600 font-mono">PX</span>
            </div>
          </Field>
        </div>

        <div className="flex items-center justify-between p-3 bg-zinc-800/30 rounded-lg border border-zinc-800">
          <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{t('dashboard.properties.plane.aspectRatio')}</div>
          <div className="px-3 py-1 bg-zinc-900 rounded text-cyan-400 font-mono text-xs shadow-inner">
            {plane.width / g} : {plane.height / g}
          </div>
        </div>

        <div className="pt-4 border-t border-zinc-800">
          <button 
            onClick={() => { if(confirm(t('dashboard.properties.plane.deleteConfirm'))) onDelete(); }} 
            className="w-full py-2.5 rounded-lg bg-red-950/20 border border-red-900/30 text-red-400 text-xs 
                       flex items-center justify-center gap-2 hover:bg-red-600 hover:text-white transition-all duration-300"
          >
            <Trash2 size={13} /> {t('dashboard.properties.plane.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}

function CanvasSettings({ el, onUpdate, onDelete, onEnterEditGroupMode, onEnterTemplateEditMode }: {
  el: CanvasElementProps;
  onUpdate: (p: Partial<CanvasElementProps>) => void;
  onDelete: () => void;
  onEnterEditGroupMode?: () => void;
  onEnterTemplateEditMode?: (templateId: string) => void;
}) {
  const { t } = useTranslation();
  const [maps, setMaps] = React.useState(() => getAvailableMaps());
  React.useEffect(() => {
    // 補上伺服器已發佈的地圖：本機地圖庫是每個瀏覽器各自一份，可能沒有這一張
    let alive = true;
    void getAvailableMapsAsync().then((all) => {
      if (alive) setMaps(all);
    });
    return () => {
      alive = false;
    };
  }, []);
  const isMap = el.canvasKind === 'map-platform';
  const isShiftCenter = el.children.some(child => 'dataUrl' in child && child.dataUrl?.startsWith('/syncdrive-api/operation-metrics/shift-center'));
  const shiftRange = el.shiftCenterRange ?? { dateMode: 'operating' as const, startTime: '00:00', timezone: 'Asia/Taipei' };
  const sectionTitle = isMap
    ? t('dashboard.properties.canvas.mapPlatform')
    : el.isGroup
      ? t('dashboard.properties.canvas.groupTitle')
      : t('dashboard.properties.canvas.canvasTitle');
  return (
    <div className="space-y-4">
      <SH icon={<Layers size={13} />} label={sectionTitle} color={isMap ? '#0ea5e9' : el.isGroup ? '#a855f7' : '#06b6d4'} />
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('dashboard.properties.label')}><input value={el.label} onChange={e => onUpdate({ label: e.target.value })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.headerTitle')}><input value={el.headerTitle ?? ''} onChange={e => onUpdate({ headerTitle: e.target.value })} className={inputCls} placeholder={t('dashboard.properties.headerTitlePlaceholder')} /></Field>
      </div>
      {el.isGroup ? (
        <Field label={t('dashboard.properties.headerFontSize')}>
          <NumberInput
            min={10}
            max={48}
            value={el.headerTitleFontSize ?? 14}
            onChange={n => onUpdate({ headerTitleFontSize: Math.max(10, Math.min(48, n || 14)) })}
            className={inputCls}
          />
          <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
            {t('dashboard.properties.headerFontHint')}
          </p>
        </Field>
      ) : null}

      {isMap && (
        <div className="space-y-3 rounded-lg border border-sky-500/25 bg-sky-500/5 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-sky-400">{t('dashboard.properties.canvas.mapSource')}</div>
          <Field label={t('dashboard.properties.canvas.selectMap')}>
            <select value={el.mapId ?? ''} onChange={e => onUpdate({ mapId: e.target.value })} className={selectCls}>
              <option value="">{t('dashboard.properties.canvas.selectMapPlaceholder')}</option>
              {maps.map(m => (
                <option key={m.mapId} value={m.mapId}>{m.displayName}</option>
              ))}
            </select>
          </Field>
          <p className="text-[9px] leading-relaxed text-zinc-500">
            {t('dashboard.properties.canvas.mapHint')}
          </p>
        </div>
      )}

      {isMap && <VehicleRoofIndicatorSettings el={el} onUpdate={onUpdate} />}

      <div className="grid grid-cols-2 gap-2">
        <Field label="X"><NumberInput value={el.x} onChange={n => onUpdate({ x: n })} className={inputCls} /></Field>
        <Field label="Y"><NumberInput value={el.y} onChange={n => onUpdate({ y: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.width')}><NumberInput value={el.width} onChange={n => onUpdate({ width: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.height')}><NumberInput value={el.height} onChange={n => onUpdate({ height: n })} className={inputCls} /></Field>
      </div>
      <Field label={t('dashboard.properties.backgroundColor')}><input type="color" value={el.backgroundColor} onChange={e => onUpdate({ backgroundColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
      <Field label={t('dashboard.properties.opacity', { pct: el.opacity })}><input type="range" min={0} max={100} value={el.opacity} onChange={e => onUpdate({ opacity: +e.target.value })} className="w-full accent-cyan-500" /></Field>

      {isShiftCenter && (
        <div className="space-y-3 rounded-lg border border-cyan-500/25 bg-cyan-500/5 p-3">
          <div className="text-[11px] font-semibold text-cyan-300">班次中心統計時間</div>
          <Field label="統計日期">
            <select
              value={shiftRange.dateMode}
              onChange={e => onUpdate({ shiftCenterRange: { ...shiftRange, dateMode: e.target.value as 'operating' | 'fixed' } })}
              className={selectCls}
            >
              <option value="operating">跟隨目前營運日期</option>
              <option value="fixed">選定日期</option>
            </select>
          </Field>
          {shiftRange.dateMode === 'fixed' && (
            <Field label="日期">
              <input type="date" value={shiftRange.date ?? ''} onChange={e => onUpdate({ shiftCenterRange: { ...shiftRange, date: e.target.value } })} className={inputCls} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="起始時間">
              <input type="time" value={shiftRange.startTime} onChange={e => onUpdate({ shiftCenterRange: { ...shiftRange, startTime: e.target.value || '00:00' } })} className={inputCls} />
            </Field>
            <Field label="結束時間">
              <input readOnly value={`隔日 ${shiftRange.startTime}`} className={inputCls} />
            </Field>
          </div>
          <p className="text-[10px] text-zinc-400">時區：{shiftRange.timezone}；區間包含起點、不包含終點。</p>
        </div>
      )}

      {el.label === '事件中心' && !el.isGroup && (
        <p className="text-[10px] leading-relaxed text-zinc-500 rounded-md border border-zinc-700/80 bg-zinc-800/40 px-2.5 py-2">
          {t('dashboard.properties.canvas.eventCenterHint')}
        </p>
      )}

      {el.canvasLayer === 'overlay' && (
        <p className="text-[10px] leading-relaxed text-zinc-500 rounded-md border border-zinc-700/80 bg-zinc-800/40 px-2.5 py-2">
          {t('dashboard.properties.canvas.overlayHint')}
        </p>
      )}

      {el.isGroup && (
        <div className="pt-3 border-t border-purple-500/20 space-y-3">
          {el.genericGroup?.enabled ? (
            // 泛用群組唯一的子畫布編輯入口：不分樣板數量都從這裡進去（預設樣板優先，
            // 沒設預設就用第一套），進去之後在工具列切換要編輯哪一套——不要在這裡
            // 另外每套樣板各放一顆「編輯內容」按鈕，不然使用者搞不清楚點哪顆才是
            // 「正確」入口，也不知道還有其他樣板可以編輯。
            onEnterTemplateEditMode && (el.genericGroup.templates?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => {
                  const templates = el.genericGroup?.templates ?? [];
                  const defaultTpl = templates.find(t => t.isDefault) ?? templates[0];
                  if (defaultTpl) onEnterTemplateEditMode(defaultTpl.id);
                }}
                className="w-full rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold py-2.5 shadow-md"
              >
                {t('dashboard.properties.canvas.editSubcanvas')}
              </button>
            )
          ) : (
            onEnterEditGroupMode && (
              <button
                type="button"
                onClick={onEnterEditGroupMode}
                className="w-full rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold py-2.5 shadow-md"
              >
                {t('dashboard.properties.canvas.editSubcanvas')}
              </button>
            )
          )}
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <Database size={12} className="text-purple-400" />
            <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wide">{t('dashboard.properties.canvas.groupBadge')}</span>
          </div>

          <Field label={t('dashboard.properties.canvas.presentMode')}>
            <select
              value={el.groupRepeatMode || 'tile'}
              onChange={e => onUpdate({ groupRepeatMode: e.target.value as 'tile' | 'scroll' | 'slots' })}
              className={selectCls}
            >
              <option value="tile">{t('dashboard.properties.canvas.modeTile')}</option>
              <option value="scroll">{t('dashboard.properties.canvas.modeScroll')}</option>
              <option value="slots">{t('dashboard.properties.canvas.modeSlots')}</option>
            </select>
          </Field>

          {(el.groupRepeatMode === 'scroll') && (
            <>
              <Field label={t('dashboard.properties.canvas.scrollInterval')}>
                <NumberInput
                  min={2}
                  value={el.groupScrollInterval ?? 5}
                  onChange={n => onUpdate({ groupScrollInterval: n })}
                  className={inputCls}
                />
              </Field>
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                {el.dualCanvasEnabled
                  ? t('dashboard.properties.canvas.scrollDualHint')
                  : t('dashboard.properties.canvas.scrollHint')}
              </p>
            </>
          )}

          {(el.groupRepeatMode === 'slots') && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('dashboard.properties.canvas.slotCount')}>
                  <NumberInput min={1} max={12} value={el.slotCount ?? 6}
                    onChange={n => onUpdate({ slotCount: n })} className={inputCls} />
                </Field>
                <Field label={t('dashboard.properties.canvas.slotKeyField')}>
                  <input value={el.slotKeyField || ''} onChange={e => onUpdate({ slotKeyField: e.target.value })}
                    className={inputCls} placeholder="shift_key" />
                </Field>
              </div>
              <Field label={t('dashboard.properties.canvas.slotAssign')}>
                <select
                  value={el.groupSlotAssignment ?? 'sticky-pool'}
                  onChange={e => onUpdate({ groupSlotAssignment: e.target.value as 'index' | 'sticky-pool' })}
                  className={selectCls}
                >
                  <option value="sticky-pool">{t('dashboard.properties.canvas.slotSticky')}</option>
                  <option value="index">{t('dashboard.properties.canvas.slotIndex')}</option>
                </select>
              </Field>
              <Field label={t('dashboard.properties.canvas.transition')}>
                <select
                  value={el.groupTransition ?? 'flip'}
                  onChange={e => onUpdate({ groupTransition: e.target.value as 'none' | 'fade' | 'flip' })}
                  className={selectCls}
                >
                  <option value="flip">{t('dashboard.properties.canvas.transitionFlip')}</option>
                  <option value="fade">{t('dashboard.properties.canvas.transitionFade')}</option>
                  <option value="none">{t('dashboard.properties.canvas.transitionNone')}</option>
                </select>
              </Field>
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                {t('dashboard.properties.canvas.slotPoolHint')}
              </p>
            </>
          )}

          <Field label={t('dashboard.properties.canvas.varMode')}>
            <select
              value={el.groupVariableMode ?? 'row'}
              onChange={e => onUpdate({ groupVariableMode: e.target.value as 'index' | 'row' })}
              className={selectCls}
            >
              <option value="index">{t('dashboard.properties.canvas.varModeIndex')}</option>
              <option value="row">{t('dashboard.properties.canvas.varModeRow')}</option>
            </select>
          </Field>

          <div className="p-2.5 bg-zinc-800/50 rounded-lg border border-zinc-700/50 space-y-1.5">
            <div className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">{t('dashboard.properties.canvas.varInject')}</div>
            <div className="text-[10px] text-zinc-400 leading-relaxed">
              {(el.groupVariableMode ?? 'row') === 'index'
                ? t('dashboard.properties.canvas.varInjectIndex', { token: `{${el.variableName || 'item'}}` })
                : t('dashboard.properties.canvas.varInjectRow', { token: t('dashboard.properties.canvas.fieldNameToken') })}
            </div>
          </div>

          {!el.genericGroup?.enabled && <DualCanvasSettings el={el} onUpdate={onUpdate} />}

          <GenericGroupSettings el={el} onUpdate={onUpdate} />

          <DataBindingSettings w={el as any} onUpdate={onUpdate as any} />

          <div className="grid grid-cols-2 gap-2">
            <Field label={t('dashboard.properties.canvas.iteratorField')}>
              <input value={el.iteratorField || ''} onChange={e => onUpdate({ iteratorField: e.target.value })} className={inputCls} placeholder={t('dashboard.properties.canvas.iteratorPlaceholder')} />
            </Field>
            <Field label={t('dashboard.properties.canvas.variableName')}>
              <input value={el.variableName || ''} onChange={e => onUpdate({ variableName: e.target.value })} className={inputCls} placeholder={t('dashboard.properties.canvas.variablePlaceholder')} />
            </Field>
          </div>

          <Field label={t('dashboard.properties.canvas.tileFit')}>
            <select
              value={el.groupTileFit || 'fill'}
              onChange={e => onUpdate({ groupTileFit: e.target.value as 'fixed' | 'fill' | 'slot' })}
              className={selectCls}
            >
              <option value="slot">{t('dashboard.properties.canvas.tileSlot')}</option>
              <option value="fill">{t('dashboard.properties.canvas.tileFill')}</option>
              <option value="fixed">{t('dashboard.properties.canvas.tileFixed')}</option>
            </select>
            <p className="mt-1 text-[10px] text-zinc-500 leading-relaxed">
              {(el.groupTileFit || 'fill') === 'slot'
                ? t('dashboard.properties.canvas.tileSlotHint')
                : (el.groupTileFit || 'fill') === 'fill'
                  ? t('dashboard.properties.canvas.tileFillHint')
                  : t('dashboard.properties.canvas.tileFixedHint')}
            </p>
          </Field>

          <Field label={t('dashboard.properties.canvas.templateSize')}>
            <div className="flex gap-2">
              <NumberInput value={el.templateWidth || 300} onChange={n => onUpdate({ templateWidth: n })} className={inputCls} />
              <NumberInput value={el.templateHeight || 180} onChange={n => onUpdate({ templateHeight: n })} className={inputCls} />
            </div>
            {(el.groupTileFit || 'fill') === 'slot' && (
              <p className="mt-1 text-[10px] text-amber-500/90">
                {t('dashboard.properties.canvas.templateSuggest', {
                  cols: el.gridColumns || 11,
                  size: (() => {
                  const padX = el.groupTilePadX ?? el.groupTilePadding ?? 4;
                  const padY = el.groupTilePadY ?? el.groupTilePadding ?? 4;
                  const s = Math.floor(
                    ((el.width || 300) - padX * 2 - (el.gapX ?? 12) * ((el.gridColumns || 11) - 1)) /
                      (el.gridColumns || 11),
                  );
                  const h = (el.height || 180) - padY * 2;
                  return `${s}×${h}`;
                })(),
                })}
              </p>
            )}
          </Field>

          {(el.groupTileFit || 'fill') === 'fixed' && (
            <Field label={t('dashboard.properties.canvas.alignFixed')}>
              <select
                value={el.groupTileAlign || 'start'}
                onChange={e => onUpdate({ groupTileAlign: e.target.value as 'start' | 'center' })}
                className={selectCls}
              >
                <option value="start">{t('dashboard.properties.canvas.alignStart')}</option>
                <option value="center">{t('dashboard.properties.canvas.alignCenter')}</option>
              </select>
            </Field>
          )}

          <Field label={t('dashboard.properties.canvas.layoutMode')}>
            <select value={el.layoutMode || 'grid'} onChange={e => onUpdate({ layoutMode: e.target.value as 'free' | 'grid' })} className={selectCls}>
              <option value="grid">{t('dashboard.properties.canvas.layoutGrid')}</option>
              <option value="free">{t('dashboard.properties.canvas.layoutFree')}</option>
            </select>
          </Field>

          {(el.layoutMode === 'grid' || !el.layoutMode) ? (
            <div className="grid grid-cols-3 gap-2">
              <Field label={t('dashboard.properties.canvas.columns')}><NumberInput value={el.gridColumns || 1} onChange={n => onUpdate({ gridColumns: n })} className={inputCls} /></Field>
              <Field label={t('dashboard.properties.canvas.gapX')}><NumberInput value={el.gapX ?? 12} onChange={n => onUpdate({ gapX: n })} className={inputCls} /></Field>
              <Field label={t('dashboard.properties.canvas.gapY')}><NumberInput value={el.gapY ?? 12} onChange={n => onUpdate({ gapY: n })} className={inputCls} /></Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('dashboard.properties.canvas.xField')}><input value={el.xField || ''} onChange={e => onUpdate({ xField: e.target.value })} className={inputCls} placeholder={t('dashboard.properties.canvas.xyPlaceholder', { axis: 'x' })} /></Field>
              <Field label={t('dashboard.properties.canvas.yField')}><input value={el.yField || ''} onChange={e => onUpdate({ yField: e.target.value })} className={inputCls} placeholder={t('dashboard.properties.canvas.xyPlaceholder', { axis: 'y' })} /></Field>
            </div>
          )}
        </div>
      )}

      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function PositionFields({ widget, onUpdate }: { widget: ChildWidget; onUpdate: (p: Partial<ChildWidget>) => void }) {
  const { t } = useTranslation();
  const minSize = 1;
  return (
    <div className="pt-2 border-t border-zinc-800">
      <div className="text-zinc-600 text-[10px] uppercase font-bold mb-2 tracking-wider">{t('dashboard.properties.positionSize')}</div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="X"><NumberInput value={widget.x} onChange={n => onUpdate({ x: n } as any)} className={inputCls} /></Field>
        <Field label="Y"><NumberInput value={widget.y} onChange={n => onUpdate({ y: n } as any)} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.width')}><NumberInput min={minSize} value={widget.width} onChange={n => onUpdate({ width: Math.max(minSize, n) } as any)} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.height')}><NumberInput min={minSize} value={widget.height} onChange={n => onUpdate({ height: Math.max(minSize, n) } as any)} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.rotation')}>
          <NumberInput
            value={widget.rotationDeg ?? 0}
            onChange={(n) => onUpdate({ rotationDeg: n } as Partial<ChildWidget>)}
            className={inputCls}
          />
        </Field>
      </div>
    </div>
  );
}
// ─── 新元件設定面板 ───────────────────────────────────────────────────────────

function ColorBlockSettings({ w, onUpdate, onDelete }: { w: ColorBlockWidget; onUpdate: (p: Partial<ColorBlockWidget>) => void; onDelete: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <SH icon={<Square size={13} />} label={t('dashboard.properties.widgets.colorBlock.title')} color="#64748b" />
      
      {/* 快捷線條預設 */}
      <div className="space-y-1.5 p-2 bg-zinc-800/40 rounded-lg border border-zinc-700/40">
        <label className="text-zinc-400 text-[10px] uppercase font-bold tracking-tight block">{t('dashboard.properties.widgets.colorBlock.quickLines')}</label>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => onUpdate({ height: 1, borderRadius: 0, borderWidth: 0 })}
            className="py-1.5 px-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] rounded border border-zinc-700/60 font-medium transition-colors text-center"
            title={t('dashboard.properties.widgets.colorBlock.line1pxTitle')}
          >
            {t('dashboard.properties.widgets.colorBlock.line1px')}
          </button>
          <button
            type="button"
            onClick={() => onUpdate({ height: 2, borderRadius: 1, borderWidth: 0 })}
            className="py-1.5 px-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] rounded border border-zinc-700/60 font-medium transition-colors text-center"
            title={t('dashboard.properties.widgets.colorBlock.line2pxTitle')}
          >
            {t('dashboard.properties.widgets.colorBlock.line2px')}
          </button>
          <button
            type="button"
            onClick={() => onUpdate({ width: 3, borderRadius: 1.5, borderWidth: 0 })}
            className="py-1.5 px-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] rounded border border-zinc-700/60 font-medium transition-colors text-center"
            title={t('dashboard.properties.widgets.colorBlock.line3pxTitle')}
          >
            {t('dashboard.properties.widgets.colorBlock.line3px')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label={t('dashboard.properties.backgroundColor')}>
          <div className="flex gap-2">
            <input type="color" value={w.backgroundColor.startsWith('#') ? w.backgroundColor : '#1e293b'}
              onChange={e => onUpdate({ backgroundColor: e.target.value })} className="w-8 h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" />
            <input value={w.backgroundColor} onChange={e => onUpdate({ backgroundColor: e.target.value })} className={`${inputCls} font-mono`} />
          </div>
        </Field>
        <Field label={t('dashboard.properties.opacityShort', { pct: w.opacity })}>
          <input type="range" min={0} max={100} value={w.opacity} onChange={e => onUpdate({ opacity: +e.target.value })} className="w-full accent-cyan-500" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label={t('dashboard.properties.borderRadius')}><NumberInput min={0} value={w.borderRadius} onChange={n => onUpdate({ borderRadius: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.borderWidth')}><NumberInput min={0} value={w.borderWidth} onChange={n => onUpdate({ borderWidth: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.borderColor')}><input type="color" value={w.borderColor.startsWith('#') ? w.borderColor : '#ffffff'} onChange={e => onUpdate({ borderColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <input type="checkbox" checked={!!w.severityStripColor}
          onChange={e => onUpdate({ severityStripColor: e.target.checked })} />
        {t('dashboard.properties.widgets.colorBlock.severityColor')}
      </label>
      {w.severityStripColor && (
        <div className="pt-2 border-t border-zinc-800">
          <SH icon={<Database size={13} />} label={t('dashboard.properties.widgets.colorBlock.mqttData')} color="#a78bfa" />
          <div className="mt-2">
            <DataBindingSettings w={w} onUpdate={onUpdate} />
          </div>
        </div>
      )}
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <input type="checkbox" checked={!!w.bindBorderFromHealthField}
          onChange={e => onUpdate({ bindBorderFromHealthField: e.target.checked })} />
        {t('dashboard.properties.widgets.colorBlock.healthBorder')}
      </label>
      {w.bindBorderFromHealthField && (
        <Field label={t('dashboard.properties.widgets.colorBlock.healthField')}>
          <input value={w.healthFieldForBorder ?? ''} onChange={e => onUpdate({ healthFieldForBorder: e.target.value })} className={inputCls} placeholder="health_status" />
        </Field>
      )}
      <Field label={t('dashboard.properties.widgets.colorBlock.borderColorVar')}>
        <input value={w.bindBorderColorVar ?? ''} onChange={e => onUpdate({ bindBorderColorVar: e.target.value })} className={inputCls} placeholder="card_border_color" />
      </Field>
      <div className="text-[9px] text-zinc-600 bg-zinc-800/50 p-2 rounded border border-zinc-700/50 italic">
        {t('dashboard.properties.widgets.colorBlock.zHint')}
      </div>
      <PositionFields widget={w as any} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function StatusBadgeSettings({ w, onUpdate, onDelete }: { w: StatusBadgeWidget; onUpdate: (p: Partial<StatusBadgeWidget>) => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const addRule = () => onUpdate({ rules: [...w.rules, { value: 'NEW', label: 'NEW', bgColor: '#1e3a5f', textColor: '#60a5fa' }] });
  const removeRule = (i: number) => onUpdate({ rules: w.rules.filter((_, j) => j !== i) });
  const updateRule = (i: number, p: Partial<StatusBadgeRule>) => onUpdate({ rules: w.rules.map((r, j) => j === i ? { ...r, ...p } : r) });

  return (
    <div className="space-y-4">
      <SH icon={<Tag size={13} />} label={t('dashboard.properties.widgets.statusBadge.title')} color="#22c55e" />
      <DataBindingSettings w={w as any} onUpdate={onUpdate as any} />
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('dashboard.properties.dataField')}><input value={w.valueField} onChange={e => onUpdate({ valueField: e.target.value })} className={inputCls} placeholder="status" /></Field>
        <Field label={t('dashboard.properties.widgets.statusBadge.defaultLabel')}><input value={w.defaultLabel} onChange={e => onUpdate({ defaultLabel: e.target.value })} className={inputCls} placeholder="UNKNOWN" /></Field>
        <Field label={t('dashboard.properties.widgets.statusBadge.defaultBg')}><input type="color" value={w.defaultBgColor} onChange={e => onUpdate({ defaultBgColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
        <Field label={t('dashboard.properties.widgets.statusBadge.defaultText')}><input type="color" value={w.defaultTextColor} onChange={e => onUpdate({ defaultTextColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
        <Field label={t('dashboard.properties.fontSize')}><NumberInput value={w.fontSize} onChange={n => onUpdate({ fontSize: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.borderRadius')}><NumberInput min={0} value={w.borderRadius} onChange={n => onUpdate({ borderRadius: n })} className={inputCls} /></Field>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={w.showDot} onChange={e => onUpdate({ showDot: e.target.checked })} className="accent-green-500 w-3 h-3" />
        <span className="text-zinc-400 text-[10px]">{t('dashboard.properties.widgets.statusBadge.showDot')}</span>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500 font-bold uppercase">{t('dashboard.properties.widgets.statusBadge.rules')}</span>
          <button onClick={addRule} className="p-1 text-cyan-500 hover:bg-zinc-800 rounded"><Plus size={12} /></button>
        </div>
        {w.rules.map((rule, i) => (
          <div key={i} className="p-2 bg-zinc-800/40 rounded border border-zinc-700/50 space-y-1.5 relative group">
            <button onClick={() => removeRule(i)} className="absolute -top-1.5 -right-1.5 p-0.5 bg-zinc-700 rounded-full text-zinc-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"><X size={10} /></button>
            <div className="grid grid-cols-2 gap-1">
              <input value={rule.value} onChange={e => updateRule(i, { value: e.target.value })} className={`${inputCls} font-mono`} placeholder={t('dashboard.properties.widgets.statusBadge.valuePlaceholder')} />
              <input value={rule.label} onChange={e => updateRule(i, { label: e.target.value })} className={inputCls} placeholder={t('dashboard.properties.widgets.statusBadge.labelPlaceholder')} />
            </div>
            <div className="flex gap-2">
              <div className="flex items-center gap-1 flex-1"><input type="color" value={rule.bgColor} onChange={e => updateRule(i, { bgColor: e.target.value })} className="w-6 h-6 cursor-pointer rounded" /><span className="text-[9px] text-zinc-500">{t('dashboard.properties.widgets.statusBadge.bg')}</span></div>
              <div className="flex items-center gap-1 flex-1"><input type="color" value={rule.textColor} onChange={e => updateRule(i, { textColor: e.target.value })} className="w-6 h-6 cursor-pointer rounded" /><span className="text-[9px] text-zinc-500">{t('dashboard.properties.widgets.statusBadge.text')}</span></div>
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
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <SH icon={<Hash size={13} />} label={t('dashboard.properties.widgets.statCard.title')} color="#e879f9" />
      <DataBindingSettings w={w as any} onUpdate={onUpdate as any} />
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('dashboard.properties.widgets.statCard.labelText')}><input value={w.label} onChange={e => onUpdate({ label: e.target.value })} className={inputCls} placeholder={t('dashboard.properties.widgets.statCard.labelPlaceholder')} /></Field>
        <Field label={t('dashboard.properties.dataField')}><input value={w.valueField} onChange={e => onUpdate({ valueField: e.target.value })} className={inputCls} placeholder="speed" /></Field>
        <Field label={t('dashboard.properties.unit')}><input value={w.unit} onChange={e => onUpdate({ unit: e.target.value })} className={inputCls} placeholder="km/h" /></Field>
        <Field label={t('dashboard.properties.iconLucide')}><input value={w.icon || ''} onChange={e => onUpdate({ icon: e.target.value })} className={inputCls} placeholder="Gauge" /></Field>
        <Field label={t('dashboard.properties.widgets.statCard.valueFontSize')}><NumberInput value={w.valueFontSize} onChange={n => onUpdate({ valueFontSize: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.widgets.statCard.labelFontSize')}><NumberInput value={w.labelFontSize} onChange={n => onUpdate({ labelFontSize: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.widgets.statCard.unitFontSize')}><NumberInput min={8} value={w.unitFontSize ?? Math.max(w.labelFontSize, 10)} onChange={n => onUpdate({ unitFontSize: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.widgets.statCard.labelPosition')}>
          <select
            value={w.labelPosition ?? 'top'}
            onChange={e => onUpdate({ labelPosition: e.target.value as StatCardWidget['labelPosition'] })}
            className={selectCls}
          >
            <option value="top">{t('dashboard.properties.sideTop')}</option>
            <option value="bottom">{t('dashboard.properties.sideBottom')}</option>
            <option value="left">{t('dashboard.properties.sideLeft')}</option>
            <option value="right">{t('dashboard.properties.sideRight')}</option>
          </select>
        </Field>
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          {t('dashboard.properties.widgets.statCard.labelPositionHint')}
        </p>
        <Field label={t('dashboard.properties.widgets.statCard.contentAlign')}>
          <select
            value={w.contentAlign ?? 'center'}
            onChange={e => onUpdate({ contentAlign: e.target.value as StatCardWidget['contentAlign'] })}
            className={selectCls}
          >
            <option value="left">{t('dashboard.properties.alignLeft')}</option>
            <option value="center">{t('dashboard.properties.alignCenter')}</option>
            <option value="right">{t('dashboard.properties.alignRight')}</option>
          </select>
        </Field>
        <Field label={t('dashboard.properties.widgets.statCard.layoutGap')}><NumberInput min={0} max={24} value={w.layoutGap ?? 4} onChange={n => onUpdate({ layoutGap: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.widgets.statCard.valueColor')}><input type="color" value={w.valueColor} onChange={e => onUpdate({ valueColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
        <Field label={t('dashboard.properties.widgets.statCard.labelColor')}><input type="color" value={w.labelColor} onChange={e => onUpdate({ labelColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
        <Field label={t('dashboard.properties.widgets.statCard.unitColor')}><input type="color" value={w.unitColor} onChange={e => onUpdate({ unitColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
        <Field label={t('dashboard.properties.borderRadius')}><NumberInput min={0} value={w.borderRadius} onChange={n => onUpdate({ borderRadius: n })} className={inputCls} /></Field>
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <input type="checkbox" checked={w.labelUppercase !== false}
          onChange={e => onUpdate({ labelUppercase: e.target.checked })} />
        {t('dashboard.properties.widgets.statCard.labelUppercase')}
      </label>
      <ColorRulesEditor rules={w.colorRules} enabled={w.colorRulesEnabled} onToggleEnabled={e => onUpdate({ colorRulesEnabled: e })} onUpdate={rules => onUpdate({ colorRules: rules })} />
      <div className="pt-2 border-t border-zinc-800 space-y-2">
        <SH icon={<Hash size={12} />} label={t('dashboard.properties.widgets.statCard.compareTitle')} color="#38bdf8" />
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          {t('dashboard.properties.widgets.statCard.compareHint')}
        </p>
        <Field label={t('dashboard.properties.widgets.statCard.targetField')}>
          <input
            value={w.compareTargetField ?? ''}
            onChange={e => onUpdate({ compareTargetField: e.target.value || undefined })}
            className={inputCls}
            placeholder="target_val"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('dashboard.properties.widgets.statCard.tolerance')}><NumberInput min={0} max={50} value={w.tolerancePct ?? 5} onChange={n => onUpdate({ tolerancePct: n })} className={inputCls} /></Field>
          <Field label={t('dashboard.properties.widgets.statCard.inBand')}><input type="color" value={w.inBandColor ?? '#38bdf8'} onChange={e => onUpdate({ inBandColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
          <Field label={t('dashboard.properties.widgets.statCard.outOfBand')}><input type="color" value={w.outOfBandColor ?? '#f87171'} onChange={e => onUpdate({ outOfBandColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
          <Field label={t('dashboard.properties.widgets.statCard.hintField')}><input value={w.hintField ?? ''} onChange={e => onUpdate({ hintField: e.target.value })} className={inputCls} placeholder="avail_hint" /></Field>
        </div>
        <Field label={t('dashboard.properties.widgets.statCard.hintIcon')}>
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
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <SH icon={<AlignJustify size={13} />} label={t('dashboard.properties.widgets.progressBar.title')} color="#38bdf8" />
      <DataBindingSettings w={w as any} onUpdate={onUpdate as any} />
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('dashboard.properties.dataField')}><input value={w.valueField} onChange={e => onUpdate({ valueField: e.target.value })} className={inputCls} placeholder="value" /></Field>
        <Field label={t('dashboard.properties.widgets.statCard.labelText')}><input value={w.label} onChange={e => onUpdate({ label: e.target.value })} className={inputCls} placeholder={t('dashboard.properties.widgets.statCard.progressPlaceholder')} /></Field>
        <Field label={t('dashboard.properties.min')}><NumberInput value={w.min} onChange={n => onUpdate({ min: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.max')}><NumberInput value={w.max} onChange={n => onUpdate({ max: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.direction')}>
          <select value={w.orientation} onChange={e => onUpdate({ orientation: e.target.value as any })} className={selectCls}>
            <option value="horizontal">{t('dashboard.properties.horizontal')}</option>
            <option value="vertical">{t('dashboard.properties.vertical')}</option>
          </select>
        </Field>
        <Field label={t('dashboard.properties.borderRadius')}><NumberInput min={0} value={w.borderRadius} onChange={n => onUpdate({ borderRadius: n })} className={inputCls} /></Field>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer">
          <input type="checkbox" checked={w.showValue} onChange={e => onUpdate({ showValue: e.target.checked })} className="accent-cyan-500 w-3 h-3" /> {t('dashboard.properties.widgets.progressBar.showValue')}
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer">
          <input type="checkbox" checked={w.showLabel} onChange={e => onUpdate({ showLabel: e.target.checked })} className="accent-cyan-500 w-3 h-3" /> {t('dashboard.properties.widgets.progressBar.showLabel')}
        </label>
      </div>
      <PositionFields widget={w as any} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function EmptyStateSettings({ w, onUpdate, onDelete }: { w: EmptyStateWidget; onUpdate: (p: Partial<EmptyStateWidget>) => void; onDelete: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <SH icon={<CircleOff size={13} />} label={t('dashboard.properties.widgets.emptyState.title')} color="#94a3b8" />
      <DataBindingSettings w={w as any} onUpdate={onUpdate as any} />
      <Field label={t('dashboard.properties.widgets.emptyState.mainLabel')}>
        <input value={w.label} onChange={e => onUpdate({ label: e.target.value })} className={inputCls} placeholder={t('dashboard.properties.widgets.emptyState.mainPlaceholder')} />
      </Field>
      <Field label={t('dashboard.properties.widgets.emptyState.subLabel')}>
        <input value={w.subLabel ?? ''} onChange={e => onUpdate({ subLabel: e.target.value })} className={inputCls} placeholder={t('dashboard.properties.widgets.emptyState.subPlaceholder')} />
      </Field>
      <Field label={t('dashboard.properties.widgets.emptyState.when')}>
        <select
          value={w.visibilityMode ?? 'when-empty'}
          onChange={e => onUpdate({ visibilityMode: e.target.value as EmptyStateWidget['visibilityMode'] })}
          className={selectCls}
        >
          <option value="when-empty">{t('dashboard.properties.widgets.emptyState.whenEmpty')}</option>
          <option value="when-has-data">{t('dashboard.properties.widgets.emptyState.whenHasData')}</option>
        </select>
      </Field>
      <Field label={t('dashboard.properties.borderRadius')}>
        <NumberInput min={0} value={w.borderRadius ?? 8} onChange={n => onUpdate({ borderRadius: n })} className={inputCls} />
      </Field>
      <Field label={t('dashboard.properties.style')}>
        <select
          value={w.emptyStateVariant ?? 'default'}
          onChange={e => onUpdate({ emptyStateVariant: e.target.value as EmptyStateWidget['emptyStateVariant'] })}
          className={selectCls}
        >
          <option value="default">{t('dashboard.properties.widgets.emptyState.variantDefault')}</option>
          <option value="minimal-center">{t('dashboard.properties.widgets.emptyState.variantMinimal')}</option>
        </select>
      </Field>
      <p className="text-[10px] text-zinc-500 leading-relaxed">
        {t('dashboard.properties.widgets.emptyState.dualHintBefore')}<strong className="text-zinc-400">{t('dashboard.properties.widgets.emptyState.dualHintStrong')}</strong>{t('dashboard.properties.widgets.emptyState.dualHintAfter')}
      </p>
      <PositionFields widget={w as any} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function ClockSettings({ w, onUpdate, onDelete }: { w: ClockWidget; onUpdate: (p: Partial<ClockWidget>) => void; onDelete: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <SH icon={<Clock size={13} />} label={t('dashboard.properties.widgets.clock.title')} color="#a3e635" />
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('dashboard.properties.widgets.clock.timeFormat')}>
          <select value={w.format} onChange={e => onUpdate({ format: e.target.value as any })} className={selectCls}>
            <option value="24h">{t('dashboard.properties.widgets.clock.h24')}</option>
            <option value="12h">{t('dashboard.properties.widgets.clock.h12')}</option>
          </select>
        </Field>
        <Field label={t('dashboard.properties.widgets.clock.dateFormat')}>
          <select value={w.dateFormat} onChange={e => onUpdate({ dateFormat: e.target.value as any })} className={selectCls}>
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
          </select>
        </Field>
        <Field label={t('dashboard.properties.widgets.clock.timeFontSize')}><NumberInput value={w.fontSize} onChange={n => onUpdate({ fontSize: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.widgets.clock.dateFontSize')}><NumberInput value={w.dateFontSize} onChange={n => onUpdate({ dateFontSize: n })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.widgets.clock.timeColor')}><input type="color" value={w.color} onChange={e => onUpdate({ color: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
        <Field label={t('dashboard.properties.widgets.clock.dateColor')}><input type="color" value={w.dateColor} onChange={e => onUpdate({ dateColor: e.target.value })} className="w-full h-8 rounded border border-zinc-700 bg-transparent cursor-pointer" /></Field>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer">
          <input type="checkbox" checked={w.showDate} onChange={e => onUpdate({ showDate: e.target.checked })} className="accent-cyan-500 w-3 h-3" /> {t('dashboard.properties.widgets.clock.showDate')}
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer">
          <input type="checkbox" checked={w.showSeconds} onChange={e => onUpdate({ showSeconds: e.target.checked })} className="accent-cyan-500 w-3 h-3" /> {t('dashboard.properties.widgets.clock.showSeconds')}
        </label>
      </div>
      <PositionFields widget={w as any} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}
/** 屬性框一行 ↔ 一個停靠點設定：「站點ID=名稱=到站／出發／到站出發」 */
function stationLine(s: StationEtaWidget['stations'][number]): string {
  const events = stationEvents(s);
  const mode = events.includes('arrive') && events.includes('depart') ? '到站出發' : events.includes('depart') ? '出發' : '到站';
  return `${s.stationId}=${s.label}=${mode}`;
}
function parseStationLine(line: string): StationEtaWidget['stations'][number] {
  const [id = '', label = '', mode = ''] = line.split('=').map((part) => part.trim());
  const events: Array<'arrive' | 'depart'> = [];
  if (/到站|arrive/i.test(mode) || !mode) events.push('arrive');
  if (/出發|depart/i.test(mode)) events.push('depart');
  return { stationId: id, label: label || id, events };
}
/** 站點到站／出發清單：站點用真實 ID，每列的方向／停靠點名稱另外填；顯示真正採用的資料來源 */
function StationEtaSettings({ w, onUpdate, onDelete }: { w: StationEtaWidget; onUpdate: (p: Partial<StationEtaWidget>) => void; onDelete: () => void }) {
  const resolveSource = usePlaneSourceResolver();
  const backendUrl = getDataSourceById(resolveSource('default-internal'))?.backendUrl;
  const effectiveUrl = resolvePlaneRestUrl(stationEtaUrl(w), backendUrl);
  const [stationsText, setStationsText] = useState(() => w.stations.map(stationLine).join('\n'));
  useEffect(() => {
    setStationsText(w.stations.map(stationLine).join('\n'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.id]);
  const commitStations = (text: string) => {
    const stations = text.split('\n').map((line) => line.trim()).filter(Boolean).map(parseStationLine).filter((s) => s.stationId);
    onUpdate({ stations });
  };
  return (
    <div className="space-y-4">
      <SH icon={<Clock size={13} />} label="到站／出發" color="#34d399" />
      <Field label="標題"><input value={w.title} onChange={e => onUpdate({ title: e.target.value })} className={inputCls} /></Field>
      <Field label="停靠點（每行：站點ID=方向／停靠點名稱=到站、出發或到站出發）">
        <textarea
          value={stationsText}
          rows={4}
          onChange={e => setStationsText(e.target.value)}
          onBlur={e => commitStations(e.target.value)}
          className={`${inputCls} font-mono`}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="最多幾筆"><NumberInput value={w.limit} onChange={n => onUpdate({ limit: Math.max(1, Math.min(10, n)) })} className={inputCls} /></Field>
        <Field label="字級"><NumberInput value={w.fontSize} onChange={n => onUpdate({ fontSize: n })} className={inputCls} /></Field>
      </div>
      <Field label="資料端點（登入端內部 API）"><input value={w.dataUrl ?? ''} onChange={e => onUpdate({ dataUrl: e.target.value })} className={`${inputCls} font-mono`} /></Field>
      <div className="rounded border border-zinc-700 bg-zinc-900/60 p-2 text-[10px] leading-relaxed text-zinc-400">
        <div className="text-zinc-300">實際採用的來源</div>
        <div className="break-all font-mono text-emerald-300">{effectiveUrl || '（未設定站點）'}</div>
        <div>每日計畫站序＋車端即時回報，時間為營運時間；重查：訂單開始／結束、車換路段、營運時鐘、每日計畫切換（{(w.invalidateTags ?? []).join('、') || '無'}）</div>
      </div>
      <PositionFields widget={w as any} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}
function BarChartSettings({ w, onUpdate, onDelete }: { w: BarChartWidget; onUpdate: (p: Partial<BarChartWidget>) => void; onDelete: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <SH icon={<BarChart2 size={13} />} label={t('dashboard.properties.widgets.barChart.title')} color="#f97316" />
      <Field label={t('dashboard.properties.title')}><input value={w.title} onChange={e => onUpdate({ title: e.target.value })} className={inputCls} /></Field>
      <DataBindingSettings w={w as any} onUpdate={onUpdate as any} />
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('dashboard.properties.widgets.chart.xField')}><input value={w.xField} onChange={e => onUpdate({ xField: e.target.value })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.widgets.barChart.yFields')}><input value={w.yFields.join(',')} onChange={e => onUpdate({ yFields: e.target.value.split(',').map(s => s.trim()) })} className={inputCls} /></Field>
        <Field label={t('dashboard.properties.direction')}>
          <select value={w.orientation} onChange={e => onUpdate({ orientation: e.target.value as BarChartWidget['orientation'] })} className={selectCls}>
            <option value="vertical">{t('dashboard.properties.widgets.barChart.vertical')}</option>
            <option value="horizontal">{t('dashboard.properties.widgets.barChart.horizontal')}</option>
          </select>
        </Field>
        <Field label={t('dashboard.properties.widgets.barChart.barPadding')}><NumberInput step={0.05} min={0} max={0.9} value={w.barPadding ?? 0.3} onChange={n => onUpdate({ barPadding: n })} className={inputCls} /></Field>
      </div>
      <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer">
        <input type="checkbox" checked={w.showValues} onChange={e => onUpdate({ showValues: e.target.checked })} className="accent-orange-500 w-3 h-3" /> {t('dashboard.properties.widgets.barChart.showValues')}
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
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <SH icon={<Monitor size={13} />} label={t('dashboard.properties.widgets.unitTelemetry.title')} color="#2dd4bf" />
      <Field label={t('dashboard.properties.widgets.unitTelemetry.vehicleLabel')}>
        <input value={w.unitLabel} onChange={e => onUpdate({ unitLabel: e.target.value })} className={inputCls} placeholder="UNIT-03" />
      </Field>
      <DataBindingSettings w={w} onUpdate={onUpdate} />
      <Field label="Telemetry Topic">
        <input value={w.mqttTelemetryTopic ?? ''} onChange={e => onUpdate({ mqttTelemetryTopic: e.target.value })} className={inputCls} placeholder="vehicle/{vehicle_code}/telemetry" />
      </Field>
      <Field label="Health Topic">
        <input value={w.mqttHealthTopic ?? ''} onChange={e => onUpdate({ mqttHealthTopic: e.target.value })} className={inputCls} />
      </Field>
      <Field label={t('dashboard.properties.variant')}>
        <select value={w.cardVariant ?? 'default'} onChange={e => onUpdate({ cardVariant: e.target.value as UnitTelemetryCardWidget['cardVariant'] })} className={selectCls}>
          <option value="default">{t('dashboard.properties.widgets.unitTelemetry.variantDefault')}</option>
          <option value="instrument-row">{t('dashboard.properties.widgets.unitTelemetry.variantInstrument')}</option>
        </select>
      </Field>
      <PositionFields widget={w} onUpdate={onUpdate as any} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function MapCanvasSettings({ w, onUpdate, onDelete }: { w: MapCanvasWidget; onUpdate: (p: Partial<MapCanvasWidget>) => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const [maps, setMaps] = React.useState(() => getAvailableMaps());
  React.useEffect(() => {
    // 補上伺服器已發佈的地圖：本機地圖庫是每個瀏覽器各自一份，可能沒有這一張
    let alive = true;
    void getAvailableMapsAsync().then((all) => {
      if (alive) setMaps(all);
    });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="space-y-3">
      <SH icon={<Map size={13} />} label={t('dashboard.properties.widgets.mapCanvas.title')} color="#0ea5e9" />
      <Field label={t('dashboard.properties.widgets.mapCanvas.mapSource')}>
        <select
          value={w.mapId}
          onChange={e => onUpdate({ mapId: e.target.value })}
          className={selectCls}
        >
          <option value="">{t('dashboard.properties.widgets.mapCanvas.selectMap')}</option>
          {maps.map(m => (
            <option key={m.mapId} value={m.mapId}>{m.displayName}</option>
          ))}
        </select>
        {maps.length === 0 && (
          <p className="text-[9px] text-zinc-500 mt-1">
            {t('dashboard.properties.widgets.mapCanvas.noMaps')}
          </p>
        )}
      </Field>
      <Field label={t('dashboard.properties.widgets.mapCanvas.zoom', { factor: w.zoomFactor?.toFixed(1) ?? '2.0' })}>
        <input
          type="range" min={0.2} max={5} step={0.1}
          value={w.zoomFactor ?? 2.0}
          onChange={e => onUpdate({ zoomFactor: +e.target.value })}
          className="w-full accent-sky-400"
        />
        <div className="flex justify-between text-[9px] text-zinc-500 mt-0.5">
          <span>{t('dashboard.properties.widgets.mapCanvas.zoomIn')}</span><span>{t('dashboard.properties.widgets.mapCanvas.zoomOut')}</span>
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
  const { t } = useTranslation();
  const rules = w.actionIconRules ?? [];

  const updateRule = (idx: number, patch: Partial<RouteActionIconRule>) => {
    const next = [...rules];
    next[idx] = { ...next[idx], ...patch };
    onUpdate({ actionIconRules: next });
  };

  const ACTION_MATCH_OPS: { value: RouteActionMatchOp; label: string }[] = [
    { value: 'eq', label: t('dashboard.properties.widgets.vehicleContainer.matchEq') },
    { value: 'gte', label: '≥' },
    { value: 'gt', label: '>' },
    { value: 'present', label: t('dashboard.properties.widgets.vehicleContainer.matchPresent') },
  ];

  return (
    <div className="space-y-3">
      <p className="text-[10px] leading-relaxed text-zinc-500">
        {t('dashboard.properties.widgets.vehicleContainer.editHint')}
      </p>
      <Field label={t('dashboard.properties.widgets.vehicleContainer.showLabel')}>
        <input
          value={w.label ?? ''}
          onChange={(e) => onUpdate({ label: e.target.value })}
          className={inputCls}
          placeholder={t('dashboard.properties.widgets.vehicleContainer.labelPlaceholder')}
        />
      </Field>
      <button
        type="button"
        onClick={onEnterEdit}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 py-2.5 text-xs font-semibold text-white hover:bg-amber-500"
      >
        <Bus size={14} />
        {t('dashboard.properties.widgets.vehicleContainer.editStyle')}
      </button>

      <SH icon={<Zap size={14} className="text-violet-400" />} label={t('dashboard.properties.widgets.vehicleContainer.actions')} color="#a78bfa" />
      <WidgetDataBindingSettings w={w} onUpdate={onUpdate} />
      <div className="grid grid-cols-3 gap-2">
        <Field label={t('dashboard.properties.widgets.vehicleContainer.offsetX')}>
          <NumberInput
            value={w.behaviorOffsetX ?? 0}
            onChange={(n) => onUpdate({ behaviorOffsetX: n })}
            className={inputCls}
          />
        </Field>
        <Field label={t('dashboard.properties.widgets.vehicleContainer.offsetY')}>
          <NumberInput
            value={w.behaviorOffsetY ?? -28}
            onChange={(n) => onUpdate({ behaviorOffsetY: n })}
            className={inputCls}
          />
        </Field>
        <Field label={t('dashboard.properties.widgets.vehicleContainer.iconSize')}>
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
            <NumberInput
              min={8}
              max={64}
              value={w.behaviorIconSize ?? 20}
              onChange={(n) =>
                onUpdate({
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
              onClick={() => onUpdate({ actionIconRules: buildVehicleBehaviorActionRules('operation_action') })}
              className="rounded bg-zinc-800 px-2 py-0.5 text-[9px] text-zinc-400 hover:text-amber-400"
            >
              {t('dashboard.properties.widgets.vehicleContainer.catalog11')}
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
            {t('dashboard.properties.widgets.vehicleContainer.rulesHint')}
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
              placeholder={t('dashboard.properties.widgets.vehicleContainer.varKeyPlaceholder')}
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
                placeholder={t('dashboard.properties.widgets.vehicleContainer.thresholdPlaceholder')}
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

export function inferColumnFieldKey(col: { name?: string; children?: ChildWidget[]; fieldKey?: string }): string {
  if (col.fieldKey && col.fieldKey.trim()) return col.fieldKey.trim();

  // 1. 從 children 中尋找第一組 {variable_name} 或 status-badge / route-progress
  if (col.children && col.children.length > 0) {
    for (const child of col.children) {
      if (child.type === 'text' && typeof child.content === 'string') {
        const match = child.content.match(/\{([a-zA-Z0-9_-]+)\}/);
        if (match && match[1]) return match[1];
      }
      if (child.type === 'status-badge') {
        const badge = child as any;
        if (badge.valueField && typeof badge.valueField === 'string') return badge.valueField;
      }
      if (child.type === 'route-progress') {
        const rp = child as any;
        if (rp.valueField && typeof rp.valueField === 'string') return rp.valueField;
      }
    }
  }

  // 2. 從欄位標題名稱語意推斷
  const name = (col.name ?? '').toLowerCase();
  if (name.includes('班次') || name.includes('代號') || name.includes('trip')) return 'trip_code';
  if (name.includes('方向') || name.includes('direction')) return 'direction_label';
  if (name.includes('載具') || name.includes('車輛') || name.includes('vehicle')) return 'vehicle_code';
  if (name.includes('路線') || name.includes('進度') || name.includes('station') || name.includes('route')) return 'route_stations';
  if (name.includes('狀態') || name.includes('status')) return 'status_label';
  if (name.includes('發車') || name.includes('時間') || name.includes('預計') || name.includes('time') || name.includes('depart')) return 'depart_time';
  if (name.includes('類型') || name.includes('項目') || name.includes('maint')) return 'maint_type_label';
  if (name.includes('操作') || name.includes('詳情') || name.includes('action') || name.includes('detail') || name.includes('key')) return 'shift_key';

  return 'value';
}

function extractSqlAliases(sql?: string): string[] {
  const defaults = [
    'trip_code',
    'direction_label',
    'vehicle_code',
    'route_stations',
    'status_label',
    'depart_time',
    'shift_key',
    'maint_type_label',
  ];
  const fields = new Set<string>(defaults);
  if (!sql) return Array.from(fields);
  // Match `AS alias` or `AS "alias"`
  const asRegex = /\bAS\s+["']?([a-zA-Z0-9_]+)["']?/gi;
  let match;
  while ((match = asRegex.exec(sql)) !== null) {
    if (match[1]) fields.add(match[1]);
  }
  // Match table.column_name or column_name in select
  const selectRegex = /(?:^|\s|,)([a-zA-Z0-9_]+)\s*(?:,|$)/gi;
  while ((match = selectRegex.exec(sql)) !== null) {
    const k = match[1];
    if (k && !['SELECT', 'FROM', 'WHERE', 'ORDER', 'BY', 'GROUP', 'JOIN', 'LIMIT', 'OFFSET', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'WITH', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'LATERAL', 'ON', 'TRUE', 'FALSE'].includes(k.toUpperCase())) {
      fields.add(k);
    }
  }
  return Array.from(fields);
}

function TabListSettings({
  w,
  onUpdate,
  onDelete,
  onEnterEditColumn,
}: {
  w: TabListWidget;
  onUpdate: (p: Partial<TabListWidget>) => void;
  onDelete: () => void;
  onEnterEditColumn?: (tabId: string, columnId: string) => void;
}) {
  const { t } = useTranslation();
  const tabs = w.tabs ?? [];
  const [selectedTabId, setSelectedTabId] = React.useState<string>(tabs[0]?.id ?? '');
  const activeTab = tabs.find(t => t.id === selectedTabId) ?? tabs[0];

  const detectedSqlFields = React.useMemo(() => {
    return extractSqlAliases(activeTab?.sqlQuery);
  }, [activeTab?.sqlQuery]);

  const updateTab = (tabId: string, patch: Partial<TabListTab>) => {
    const updated = tabs.map(t => (t.id === tabId ? { ...t, ...patch } : t));
    onUpdate({ tabs: updated });
  };

  // 自動填入所有未設定 fieldKey 的欄位
  React.useEffect(() => {
    if (!activeTab) return;
    let changed = false;
    const updatedCols = activeTab.columns.map(col => {
      if (!col.fieldKey || !col.fieldKey.trim()) {
        const inferred = inferColumnFieldKey(col);
        if (inferred) {
          changed = true;
          return { ...col, fieldKey: inferred };
        }
      }
      return col;
    });
    if (changed) {
      updateTab(activeTab.id, { columns: updatedCols });
    }
  }, [activeTab?.id]);

  const addTab = () => {
    const newId = `tab-${Date.now()}`;
    const newTab: TabListTab = {
      id: newId,
      label: t('dashboard.properties.widgets.tabList.newTab', { n: tabs.length + 1 }),
      columns: [
        {
          id: `col-${Date.now()}-1`,
          name: t('dashboard.properties.widgets.tabList.columnDefault'),
          fieldKey: 'name',
          width: 120,
          align: 'left',
          children: [],
        },
      ],
    };
    onUpdate({ tabs: [...tabs, newTab] });
    setSelectedTabId(newId);
  };

  const deleteTab = (tabId: string) => {
    if (tabs.length <= 1) return;
    const remaining = tabs.filter(t => t.id !== tabId);
    onUpdate({ tabs: remaining });
    if (selectedTabId === tabId) {
      setSelectedTabId(remaining[0]?.id ?? '');
    }
  };

  const updateColumn = (colId: string, patch: Partial<TabListColumn>) => {
    if (!activeTab) return;
    const updatedCols = activeTab.columns.map(c => (c.id === colId ? { ...c, ...patch } : c));
    updateTab(activeTab.id, { columns: updatedCols });
  };

  const patchColumnTextStyle = (
    colId: string | null,
    style: { fontSize?: number; color?: string },
  ) => {
    const apply = (columns: TabListColumn[]) =>
      columns.map(c => {
        if (colId && c.id !== colId) return c;
        return {
          ...c,
          ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
          ...(style.color !== undefined ? { textColor: style.color } : {}),
          children: (c.children ?? []).map(ch => {
            if (ch.type === 'text') {
              return {
                ...ch,
                ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
                ...(style.color !== undefined ? { color: style.color } : {}),
              };
            }
            if (ch.type === 'status-badge' && style.fontSize !== undefined) {
              return { ...ch, fontSize: style.fontSize };
            }
            return ch;
          }),
        };
      });
    if (colId) {
      if (!activeTab) return;
      updateTab(activeTab.id, { columns: apply(activeTab.columns) });
      return;
    }
    onUpdate({
      ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
      ...(style.color !== undefined ? { textColor: style.color } : {}),
      tabs: tabs.map(t => ({ ...t, columns: apply(t.columns) })),
    });
  };

  const setGlobalAlign = (align: 'left' | 'center' | 'right') => {
    const updatedTabs = tabs.map(tab => ({
      ...tab,
      align,
      columns: tab.columns.map(col => ({
        ...col,
        align,
        children: (col.children ?? []).map(ch => ch.type === 'text' ? { ...ch, textAlign: align } : ch),
      })),
    }));
    onUpdate({
      align,
      tabs: updatedTabs,
    });
  };

  const addColumn = () => {
    if (!activeTab) return;
    const newColId = `col-${Date.now()}`;
    const newCol: TabListColumn = {
      id: newColId,
      name: t('dashboard.properties.widgets.tabList.newColumn', { n: activeTab.columns.length + 1 }),
      fieldKey: '',
      width: 100,
      align: w.align ?? activeTab.align ?? 'left',
      children: [],
    };
    updateTab(activeTab.id, { columns: [...activeTab.columns, newCol] });
  };

  const deleteColumn = (colId: string) => {
    if (!activeTab || activeTab.columns.length <= 1) return;
    const remaining = activeTab.columns.filter(c => c.id !== colId);
    updateTab(activeTab.id, { columns: remaining });
  };

  const selectTab = (tabId: string) => {
    setSelectedTabId(tabId);
    onUpdate({ activeTabId: tabId });
  };

  useEffect(() => {
    if (w.activeTabId && w.activeTabId !== selectedTabId) {
      setSelectedTabId(w.activeTabId);
    }
  }, [w.activeTabId]);

  return (
    <div className="space-y-4 text-xs">
      <SH icon={<List size={14} />} label={t('dashboard.properties.widgets.tabList.title')} color="#38bdf8" />

      <label className="flex items-center justify-between gap-2 text-zinc-300">
        <span>顯示欄位名稱</span>
        <input type="checkbox" checked={w.showHeader !== false} onChange={e => onUpdate({ showHeader: e.target.checked })} />
      </label>

      {/* Tab 管理 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-zinc-400 text-[11px] font-medium">{t('dashboard.properties.widgets.tabList.tabList')}</label>
          <button
            type="button"
            onClick={addTab}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-600/30 text-blue-300 hover:bg-blue-600/50 text-[10px]"
          >
            <Plus size={11} /> {t('dashboard.properties.widgets.tabList.addTab')}
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => selectTab(tab.id)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                tab.id === (activeTab?.id ?? '')
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab && (
        <div className="p-2.5 rounded-lg bg-zinc-800/40 border border-zinc-700/40 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-zinc-300">
              {t('dashboard.properties.widgets.tabList.configureTab', { label: activeTab.label })}
            </span>
            {tabs.length > 1 && (
              <button
                type="button"
                onClick={() => deleteTab(activeTab.id)}
                className="text-red-400 hover:text-red-300 text-[10px] flex items-center gap-0.5"
              >
                <Trash2 size={11} /> {t('dashboard.properties.widgets.tabList.deleteTab')}
              </button>
            )}
          </div>

          {/* {t('dashboard.properties.widgets.tabList.tabName')} */}
          <div>
            <label className="text-zinc-400 text-[10px] block mb-1">{t('dashboard.properties.widgets.tabList.tabName')}</label>
            <input
              type="text"
              value={activeTab.label}
              onChange={e => updateTab(activeTab.id, { label: e.target.value })}
              className={inputCls}
              placeholder={t('dashboard.properties.widgets.tabList.tabNamePlaceholder')}
            />
          </div>

          <WidgetDataBindingSettings w={activeTab} onUpdate={(patch) => updateTab(activeTab.id, patch)} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="資料列 JSON 路徑"><input value={activeTab.dataRowPath ?? ''} onChange={e => updateTab(activeTab.id, { dataRowPath: e.target.value })} className={inputCls} placeholder="events" /></Field>
            <Field label="每列識別路徑"><input value={activeTab.rowKeyField ?? ''} onChange={e => updateTab(activeTab.id, { rowKeyField: e.target.value })} className={inputCls} placeholder="key" /></Field>
          </div>
          <Field label="API／MQTT 合併識別路徑">
            <input value={activeTab.mergeKeyField ?? ''} onChange={e => updateTab(activeTab.id, { mergeKeyField: e.target.value })} className={inputCls} placeholder="event_id（同時使用兩來源時必填）" />
          </Field>
          <div className="pt-2 border-t border-zinc-700/50 space-y-2">
            <label className="flex items-center justify-between gap-2 text-zinc-300">
              <span>耦合同一業務事件</span>
              <input
                type="checkbox"
                checked={activeTab.rowCoupling?.enabled === true}
                onChange={e => updateTab(activeTab.id, {
                  rowCoupling: {
                    enabled: e.target.checked,
                    relationKeyField: activeTab.rowCoupling?.relationKeyField ?? 'coupling_key',
                    stableKeyField: activeTab.rowCoupling?.stableKeyField ?? 'row_key',
                    statusField: activeTab.rowCoupling?.statusField ?? 'event',
                    statusOrder: activeTab.rowCoupling?.statusOrder ?? ['arrive', 'depart'],
                    fieldMappings: activeTab.rowCoupling?.fieldMappings,
                  },
                })}
              />
            </label>
            {activeTab.rowCoupling?.enabled && <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="關聯欄位"><input value={activeTab.rowCoupling.relationKeyField} onChange={e => updateTab(activeTab.id, { rowCoupling: { ...activeTab.rowCoupling!, relationKeyField: e.target.value } })} className={inputCls} /></Field>
                <Field label="穩定列識別"><input value={activeTab.rowCoupling.stableKeyField} onChange={e => updateTab(activeTab.id, { rowCoupling: { ...activeTab.rowCoupling!, stableKeyField: e.target.value } })} className={inputCls} /></Field>
                <Field label="狀態欄位"><input value={activeTab.rowCoupling.statusField} onChange={e => updateTab(activeTab.id, { rowCoupling: { ...activeTab.rowCoupling!, statusField: e.target.value } })} className={inputCls} /></Field>
                <Field label="狀態順序"><input value={activeTab.rowCoupling.statusOrder.join(',')} onChange={e => updateTab(activeTab.id, { rowCoupling: { ...activeTab.rowCoupling!, statusOrder: e.target.value.split(',').map(v => v.trim()).filter(Boolean) } })} className={inputCls} /></Field>
              </div>
              <Field label="各狀態欄位映射（JSON）">
                <textarea
                  key={JSON.stringify(activeTab.rowCoupling.fieldMappings ?? {})}
                  defaultValue={JSON.stringify(activeTab.rowCoupling.fieldMappings ?? {}, null, 2)}
                  onBlur={e => {
                    try {
                      const value = JSON.parse(e.target.value || '{}') as Record<string, Record<string, string>>;
                      updateTab(activeTab.id, { rowCoupling: { ...activeTab.rowCoupling!, fieldMappings: value } });
                    } catch { e.target.value = JSON.stringify(activeTab.rowCoupling?.fieldMappings ?? {}, null, 2); }
                  }}
                  className={`${inputCls} min-h-20 font-mono`}
                />
              </Field>
            </>}
          </div>

          {/* 欄位清單 */}
          <div className="pt-2 border-t border-zinc-700/50 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-zinc-300 text-[11px] font-medium">{t('dashboard.properties.widgets.tabList.columns')}</label>
              <button
                type="button"
                onClick={addColumn}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/50 text-[10px] font-medium transition-colors"
              >
                <Plus size={12} /> {t('dashboard.properties.widgets.tabList.addColumn')}
              </button>
            </div>

            <div className="space-y-3.5 max-h-[460px] overflow-y-auto pr-1">
              {activeTab.columns.map((col, idx) => {
                const effectiveFieldKey = col.fieldKey || inferColumnFieldKey(col);
                return (
                <div
                  key={col.id}
                  className="p-3 rounded-lg bg-zinc-900/90 border border-zinc-700/50 space-y-2.5"
                >
                  {/* 第 1 行：序號 + 欄位標題 + 刪除 */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-zinc-300 text-[10px] font-bold">
                        {t('dashboard.properties.widgets.tabList.columnTitle', { n: idx + 1 })}
                      </label>
                      {activeTab.columns.length > 1 && (
                        <button
                          type="button"
                          onClick={() => deleteColumn(col.id)}
                          className="text-zinc-500 hover:text-red-400 p-1 rounded hover:bg-red-950/40"
                          title={t('dashboard.properties.widgets.tabList.deleteColumn')}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={col.name}
                      onChange={e => updateColumn(col.id, { name: e.target.value })}
                      className={`${inputCls} w-full text-xs`}
                      placeholder={t('dashboard.properties.widgets.tabList.columnNamePlaceholder')}
                    />
                  </div>

                  {/* 第 2 行：綁定 SQL 欄位別名 (下拉選單) */}
                  <div className="space-y-1">
                    <label className="text-zinc-400 text-[10px]">
                      {t('dashboard.properties.widgets.tabList.bindAlias')}
                    </label>
                    <input
                      list={`tab-list-fields-${activeTab.id}`}
                      value={effectiveFieldKey}
                      onChange={e => updateColumn(col.id, { fieldKey: e.target.value })}
                      className={`${inputCls} w-full text-xs py-1.5 font-mono`}
                      placeholder="欄位或 JSON 路徑"
                    />
                    <datalist id={`tab-list-fields-${activeTab.id}`}>{detectedSqlFields.map(f => <option key={f} value={f} />)}</datalist>
                    <select value={col.format ?? 'text'} onChange={e => updateColumn(col.id, { format: e.target.value as 'text' | 'countdown' })} className={`${selectCls} mt-1`}>
                      <option value="text">文字</option><option value="countdown">時間欄位轉倒數</option>
                    </select>
                  </div>

                  {/* 第 3 行：欄位寬度 */}
                  <div className="space-y-1">
                    <label className="text-zinc-400 text-[10px]">
                      {t('dashboard.properties.widgets.tabList.columnWidth')}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <NumberInput
                        value={col.width}
                        onChange={n => updateColumn(col.id, { width: Math.max(30, n) })}
                        className={`${inputCls} w-full text-xs font-mono`}
                        placeholder={t('dashboard.properties.widgets.tabList.widthPlaceholder')}
                      />
                      <span className="text-zinc-500 text-xs shrink-0">px</span>
                    </div>
                  </div>

                  {/* Column text color (content font size is table-wide below) */}
                  {(() => {
                    const firstText = (col.children ?? []).find(ch => ch.type === 'text') as TextWidget | undefined;
                    const colTextColor = col.textColor ?? firstText?.color ?? w.textColor ?? '#cbd5e1';
                    return (
                      <div className="space-y-1">
                        <label className="text-zinc-400 text-[10px]">{t('dashboard.properties.widgets.tabList.columnTextColor')}</label>
                        <div
                          className="w-full h-8 rounded border border-zinc-700 relative overflow-hidden cursor-pointer hover:border-zinc-500 transition-colors shadow-inner"
                          style={{ backgroundColor: colTextColor }}
                        >
                          <input
                            type="color"
                            value={colTextColor.startsWith('#') ? colTextColor : '#cbd5e1'}
                            onChange={e => patchColumnTextStyle(col.id, { color: e.target.value })}
                            className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                            title={t('dashboard.properties.widgets.tabList.pickColumnColor')}
                          />
                        </div>
                      </div>
                    );
                  })()}

                  {/* 第 5 行：進入元件編輯按鈕 */}
                  <button
                    type="button"
                    onClick={() => onEnterEditColumn?.(activeTab.id, col.id)}
                    className="w-full mt-1 py-2 px-3 rounded-md bg-blue-600/20 hover:bg-blue-600/40 border border-blue-500/40 text-blue-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-all shadow-sm"
                  >
                    <Edit3 size={13} /> {t('dashboard.properties.widgets.tabList.editCell')}
                  </button>
                </div>
              );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── 全域字體與外觀設定 ────────────────────────────────────── */}
      <div className="space-y-3 pt-3 border-t border-zinc-800">
        <label className="text-zinc-300 text-[11px] font-semibold flex items-center gap-1.5">
          <Palette size={13} className="text-cyan-400" /> {t('dashboard.properties.widgets.tabList.globalStyle')}
        </label>

        {/* Tab 標籤樣式 */}
        <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-800 space-y-2">
          <span className="text-[10px] text-zinc-400 font-bold block">{t('dashboard.properties.widgets.tabList.tabStyle')}</span>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-zinc-500 text-[9px] block mb-1">{t('dashboard.properties.widgets.tabList.tabFontSize')}</label>
              <NumberInput
                value={w.tabFontSize ?? 14}
                onChange={n => onUpdate({ tabFontSize: n })}
                className={`${inputCls} text-xs`}
              />
            </div>
            <div>
              <label className="text-zinc-500 text-[9px] block mb-1">{t('dashboard.properties.widgets.tabList.tabActiveColor')}</label>
              <div
                className="w-full h-8 rounded border border-zinc-700 relative overflow-hidden cursor-pointer hover:border-zinc-500 transition-colors shadow-inner flex items-center justify-center"
                style={{ backgroundColor: w.tabActiveColor ?? '#3b82f6' }}
              >
                <input
                  type="color"
                  value={w.tabActiveColor ?? '#3b82f6'}
                  onChange={e => onUpdate({ tabActiveColor: e.target.value })}
                  className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                  title={t('dashboard.properties.widgets.tabList.pickActive')}
                />
              </div>
            </div>
            <div>
              <label className="text-zinc-500 text-[9px] block mb-1">{t('dashboard.properties.widgets.tabList.tabInactiveColor')}</label>
              <div
                className="w-full h-8 rounded border border-zinc-700 relative overflow-hidden cursor-pointer hover:border-zinc-500 transition-colors shadow-inner flex items-center justify-center"
                style={{ backgroundColor: w.tabInactiveColor ?? '#64748b' }}
              >
                <input
                  type="color"
                  value={w.tabInactiveColor ?? '#64748b'}
                  onChange={e => onUpdate({ tabInactiveColor: e.target.value })}
                  className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                  title={t('dashboard.properties.widgets.tabList.pickInactive')}
                />
              </div>
            </div>
          </div>
        </div>

        {/* 表頭與表身字體顏色 */}
        <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-800 space-y-2.5">
          <span className="text-[10px] text-zinc-400 font-bold block">{t('dashboard.properties.widgets.tabList.tableStyle')}</span>

          {/* {t('dashboard.properties.widgets.tabList.tableAlign')} */}
          <div>
            <label className="text-zinc-500 text-[9px] block mb-1">{t('dashboard.properties.widgets.tabList.tableAlign')}</label>
            <div className="flex items-center bg-zinc-800 border border-zinc-700 rounded p-0.5 gap-0.5">
              <button
                type="button"
                onClick={() => setGlobalAlign('left')}
                className={`flex-1 py-1.5 flex items-center justify-center rounded transition-colors ${
                  (w.align ?? 'left') === 'left'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
                }`}
                title={t('dashboard.properties.widgets.tabList.alignLeftTitle')}
              >
                <AlignLeft size={13} />
              </button>
              <button
                type="button"
                onClick={() => setGlobalAlign('center')}
                className={`flex-1 py-1.5 flex items-center justify-center rounded transition-colors ${
                  w.align === 'center'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
                }`}
                title={t('dashboard.properties.widgets.tabList.alignCenterTitle')}
              >
                <AlignCenter size={13} />
              </button>
              <button
                type="button"
                onClick={() => setGlobalAlign('right')}
                className={`flex-1 py-1.5 flex items-center justify-center rounded transition-colors ${
                  w.align === 'right'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
                }`}
                title={t('dashboard.properties.widgets.tabList.alignRightTitle')}
              >
                <AlignRight size={13} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-zinc-500 text-[9px] block mb-1">{t('dashboard.properties.widgets.tabList.headerFontSize')}</label>
              <NumberInput
                value={w.headerFontSize ?? 12}
                onChange={n => onUpdate({ headerFontSize: n })}
                className={`${inputCls} text-xs`}
              />
            </div>
            <div>
              <label className="text-zinc-500 text-[9px] block mb-1">{t('dashboard.properties.widgets.tabList.headerTextColor')}</label>
              <div
                className="w-full h-8 rounded border border-zinc-700 relative overflow-hidden cursor-pointer hover:border-zinc-500 transition-colors shadow-inner flex items-center justify-center"
                style={{ backgroundColor: w.headerTextColor ?? '#94a3b8' }}
              >
                <input
                  type="color"
                  value={w.headerTextColor ?? '#94a3b8'}
                  onChange={e => onUpdate({ headerTextColor: e.target.value })}
                  className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                  title={t('dashboard.properties.widgets.tabList.pickHeaderColor')}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-zinc-500 text-[9px] block mb-1">{t('dashboard.properties.widgets.tabList.contentFontSize')}</label>
              <NumberInput
                value={w.fontSize ?? 13}
                onChange={n => onUpdate(applyTabListContentFontSize(w, Math.max(8, n || 13)))}
                className={`${inputCls} text-xs`}
              />
            </div>
            <div>
              <label className="text-zinc-500 text-[9px] block mb-1">{t('dashboard.properties.widgets.tabList.contentTextColor')}</label>
              <div
                className="w-full h-8 rounded border border-zinc-700 relative overflow-hidden cursor-pointer hover:border-zinc-500 transition-colors shadow-inner flex items-center justify-center"
                style={{ backgroundColor: w.textColor ?? '#cbd5e1' }}
              >
                <input
                  type="color"
                  value={w.textColor ?? '#cbd5e1'}
                  onChange={e => onUpdate({ textColor: e.target.value })}
                  className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                  title={t('dashboard.properties.widgets.tabList.pickContentColor')}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-zinc-500 text-[9px] block mb-1">{t('dashboard.properties.widgets.tabList.rowHeight')}</label>
              <NumberInput
                value={w.rowHeight ?? 48}
                onChange={n => onUpdate({ rowHeight: n })}
                className={`${inputCls} text-xs`}
              />
            </div>
            <div>
              <label className="text-zinc-500 text-[9px] block mb-1">{t('dashboard.properties.widgets.tabList.headerHeight')}</label>
              <NumberInput
                value={w.headerHeight ?? 38}
                onChange={n => onUpdate({ headerHeight: n })}
                className={`${inputCls} text-xs`}
              />
            </div>
          </div>
        </div>

        {/* 輔助標籤 */}
        <div>
          <label className="text-zinc-400 text-[10px] block mb-1">{t('dashboard.properties.widgets.tabList.auxLabel')}</label>
          <input
            type="text"
            value={w.currentScheduleLabel ?? t('dashboard.properties.widgets.tabList.auxLabelDefault')}
            onChange={e => onUpdate({ currentScheduleLabel: e.target.value })}
            className={inputCls}
          />
        </div>
      </div>

      <PositionFields widget={w as ChildWidget} onUpdate={onUpdate as (p: Partial<ChildWidget>) => void} />
      <DeleteBtn onDelete={onDelete} />
    </div>
  );
}

function DeleteBtn({ onDelete }: { onDelete: () => void }) {
  const { t } = useTranslation();
  return (
    <button onClick={onDelete} className="w-full py-2 rounded-lg bg-red-900/20 border border-red-800/40 text-red-400 text-[10px] font-bold uppercase flex items-center justify-center gap-1.5 hover:bg-red-900/40 transition-colors mt-2">
      <Trash2 size={12} /> {t('dashboard.properties.removeWidget')}
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
  /** 正在編輯 Tab 清單某一欄的單元格範本時顯示提示 */
  editingTabListColumn?: { tabLabel: string; columnName: string } | null;
  onUpdatePlane: (p: Partial<Pick<DashboardPlane, 'name' | 'width' | 'height' | 'viewportMode'>>) => void;
  onDeletePlane: () => void;
  onUpdateElement: (p: Partial<CanvasElementProps>) => void;
  onDeleteElement: () => void;
  onUpdateChild: (p: Partial<ChildWidget>) => void;
  onDeleteChild: () => void;
  onEnterEditGroupMode?: (groupId: string) => void;
  /** 泛用群組：進入編輯指定樣板的子畫布（只在群組被選取、還沒進入子畫布編輯時可用） */
  onEnterTemplateEditMode?: (templateId: string) => void;
  onEnterEditVehicleContainer?: () => void;
  onEnterEditTabListCell?: (tabId: string, columnId: string) => void;
  /** 雙畫板子畫布：選取中間閘道設定區 */
  dualGateSettingsActive?: boolean;
  /** 選取元件所在的群組（子畫布或樣板編輯中）；原數據綁定區塊依它顯示繼承來源 */
  dataContextGroup?: CanvasElementProps | null;
  dataContextRow?: Record<string, unknown> | null;
  dataContextStatus?: { loading: boolean; error: string | null; stale: boolean };
}

export function PropertiesPanel({
  isEditMode,
  activePlane,
  editingGroupLabel,
  editingGroup,
  selectedElement,
  selectedChild,
  selectedChildCount = 0,
  editingTabListColumn = null,
  onUpdatePlane, onDeletePlane,
  onUpdateElement, onDeleteElement,
  onUpdateChild, onDeleteChild,
  onEnterEditGroupMode,
  onEnterTemplateEditMode,
  onEnterEditVehicleContainer,
  onEnterEditTabListCell,
  dualGateSettingsActive,
  dataContextGroup = null,
  dataContextRow = null,
  dataContextStatus = { loading: false, error: null, stale: false },
}: Props) {
  const { t } = useTranslation();
  const { issueMap } = useBindingHealth();
  const selectedIssue = selectedChild
    ? issueMap.get(selectedChild.id)
    : selectedElement
      ? issueMap.get(selectedElement.id)
      : undefined;

  if (!activePlane) {
    return (
      <aside className="w-64 bg-zinc-900 border-l border-zinc-800 flex items-center justify-center">
        <p className="text-zinc-600 text-xs text-center px-4">{t('dashboard.properties.selectPlane')}</p>
      </aside>
    );
  }

  if (!isEditMode) {
    return (
      <aside className="w-64 bg-zinc-900 border-l border-zinc-800 flex flex-col items-center justify-center p-6 text-center gap-3">
        <Monitor size={28} className="text-zinc-600" />
        <p className="text-zinc-400 text-sm font-medium">{t('dashboard.properties.viewModeTitle')}</p>
        <p className="text-zinc-500 text-xs leading-relaxed">
          {t('dashboard.properties.viewModeHintBefore')}{' '}
          <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-400">E</kbd>{' '}
          {t('dashboard.properties.viewModeHintAfter')}
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
            <p className="font-semibold text-cyan-400 mb-1">{t('dashboard.properties.dualGateTitle', { label: editingGroupLabel })}</p>
            <p>{t('dashboard.properties.dualGateHint')}</p>
          </div>
        ) : editingGroupLabel && editingGroup && !selectedChild ? (
          <GroupInheritedVariablesSection group={editingGroup} />
        ) : editingGroupLabel ? (
          <div className="mb-3 p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-800/40 text-cyan-200/90 text-[10px] leading-relaxed">
            <p className="font-semibold text-cyan-400 mb-1">{t('dashboard.properties.subcanvasTitle', { label: editingGroupLabel })}</p>
            <p>
              {editingGroup?.dualCanvasEnabled
                ? t('dashboard.properties.subcanvasDual')
                : t('dashboard.properties.subcanvasSingle')}
              {editingGroup && (editingGroup.groupVariableMode ?? 'row') === 'index' && (
                <>
                  {' '}
                  {t('dashboard.properties.previewIndex', {
                    token: `{${editingGroup.variableName || 'item'}}=0`,
                  })}
                </>
              )}
            </p>
          </div>
        ) : editingTabListColumn ? (
          <div className="mb-3 p-2.5 rounded-lg bg-blue-950/30 border border-blue-800/40 text-blue-200/90 text-[10px] leading-relaxed">
            <p className="font-semibold text-blue-400 mb-1">
              {t('dashboard.properties.cellTemplateTitle', {
                tab: editingTabListColumn.tabLabel,
                column: editingTabListColumn.columnName,
              })}
            </p>
            <p>{t('dashboard.properties.cellTemplateHint')}</p>
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
            <p className="text-zinc-300 text-sm font-medium">{t('dashboard.properties.multiSelectTitle', { count: selectedChildCount })}</p>
            <p className="text-zinc-500 text-xs leading-relaxed px-2">
              {t('dashboard.properties.multiSelectHint')}
            </p>
          </div>
        ) : selectedChild ? (
          <React.Fragment key={selectedChild.id}>
          <WidgetDataBindingContext.Provider value={{
            widget: selectedChild,
            group: dataContextGroup ?? editingGroup ?? null,
            previewRow: dataContextRow,
            ...dataContextStatus,
          }}>
          {(() => {
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
              case 'maintenance-distribution': return <MaintenanceDistributionSettings {...props as any} />;
              case 'route-progress': return <RouteProgressSettings {...props as any} />;
              case 'color-block':    return <ColorBlockSettings {...props as any} />;
              case 'status-badge':   return <StatusBadgeSettings {...props as any} />;
              case 'stat-card':      return <StatCardSettings {...props as any} />;
              case 'progress-bar':   return <ProgressBarSettings {...props as any} />;
              case 'segment-bar':    return <SegmentBarSettings {...props as any} />;
              case 'clock':          return <ClockSettings {...props as any} />;
              case 'station-eta':    return <StationEtaSettings {...props as any} />;
              case 'empty-state':    return <EmptyStateSettings {...props as any} />;
              case 'map-canvas':     return <MapCanvasSettings {...props as any} />;
              case 'unit-telemetry-card': return <UnitTelemetrySettings {...props as any} />;
              case 'tab-list':
              case 'shift-list':
                return (
                  <TabListSettings
                    w={selectedChild as TabListWidget}
                    onUpdate={onUpdateChild as (p: Partial<TabListWidget>) => void}
                    onDelete={onDeleteChild}
                    onEnterEditColumn={onEnterEditTabListCell}
                  />
                );
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
                    <p>{t('dashboard.properties.unsupportedType')}</p>
                    <button type="button" onClick={props.onDelete} className="w-full rounded bg-red-900/40 py-2 text-red-400">{t('dashboard.properties.deleteWidget')}</button>
                  </div>
                );
            }
          })()}
          </WidgetDataBindingContext.Provider>
          </React.Fragment>
        ) : editingTabListColumn ? (
          <p className="text-zinc-500 text-xs leading-relaxed px-1 py-6 text-center">
            {t('dashboard.properties.cellTemplateEmpty')}
          </p>
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
            onEnterTemplateEditMode={
              !editingGroupLabel && selectedElement.isGroup && onEnterTemplateEditMode
                ? (templateId: string) => onEnterTemplateEditMode(templateId)
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
