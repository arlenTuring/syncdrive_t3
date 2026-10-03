import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CanvasElementProps, ChildWidget, FreshnessPolicy, GroupDataSource, WidgetDataBinding } from '../types';
import { resolveFreshness, FRESHNESS_POLICY_OPTIONS } from '../utils/resolveFreshness';
import { DataSourcePicker } from './DataSourcePicker';
import { DataSourceIdSelect } from './DataSourceIdSelect';
import { getDataSourceById } from '../store/useDataSourceStore';
import { dataSourceSelectionPatch, describeWidgetDataLineage } from '../utils/widgetDataLineage';
import { getRowSourceMetadata } from '../utils/rowRules';
import { getPostProcessorDefinition } from '../hooks/useShiftSourcePostProcessors';

const inputCls = `w-full bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-zinc-200 text-xs
  focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 transition-colors`;
const readonlyCls = `${inputCls} bg-zinc-950/60 text-zinc-300 font-mono`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="block text-zinc-500 text-[10px] uppercase font-bold tracking-tight">{label}</label>{children}</div>;
}

export interface WidgetDataBindingContextValue {
  widget: ChildWidget;
  group: CanvasElementProps | null;
  previewRow: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
}

// 這個 context 必須與面板共用；它不含可熱更新的狀態。
// eslint-disable-next-line react-refresh/only-export-components
export const WidgetDataBindingContext = React.createContext<WidgetDataBindingContextValue | null>(null);

type Mode = 'sql' | 'mqtt' | 'rest';

function activeGroupSources(group: CanvasElementProps | null, previewRow: Record<string, unknown> | null): GroupDataSource[] {
  if (!group) return [];
  if (!group.genericGroup?.enabled) return [group as GroupDataSource];
  const sourceId = getRowSourceMetadata(previewRow)?.sourceId;
  const sources = group.genericGroup.sources ?? [];
  return sourceId ? sources.filter((source) => source.id === sourceId) : sources;
}

function sourceName(id: string | undefined): string {
  if (!id) return '未設定';
  const source = getDataSourceById(id);
  return source ? `${source.name} (${id})` : id;
}

function updateText(binding: WidgetDataBinding, t: ReturnType<typeof useTranslation>['t']): string {
  const policy = (binding.freshnessPolicy ?? 'auto') as FreshnessPolicy;
  const resolved = resolveFreshness(binding);
  return `${t(`dashboard.properties.freshnessOpt.${policy}`)} · ${t('dashboard.properties.freshnessCurrent', {
    reason: t(`dashboard.properties.freshnessReason.${resolved.reasonKey}`, resolved.reasonParams),
  })}`;
}

function ReadonlyValue({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return (
    <Field label={label}>
      {multiline
        ? <textarea readOnly value={value || '未設定'} rows={5} className={`${readonlyCls} resize-y leading-relaxed`} />
        : <input readOnly value={value || '未設定'} className={readonlyCls} />}
    </Field>
  );
}

function InheritedSource({ source, mode, fields }: { source: GroupDataSource; mode: Mode; fields: string[] }) {
  const { t } = useTranslation();
  const label = source.label || source.id || '群組來源';
  return (
    <div className="space-y-2 rounded-md border border-purple-700/40 bg-purple-950/20 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="rounded bg-purple-500/20 px-1.5 py-0.5 font-bold text-purple-200">繼承群組</span>
        <span className="text-zinc-300">{label}</span><span className="text-zinc-500">基礎資料</span>
      </div>
      {mode === 'sql' && <><ReadonlyValue label="SQL 資料來源" value={sourceName(source.dataSourceId)} /><ReadonlyValue label="SQL 查詢" value={source.sqlQuery ?? ''} multiline /></>}
      {mode === 'mqtt' && <><ReadonlyValue label="MQTT 資料來源" value={sourceName(source.mqttDataSourceId)} /><ReadonlyValue label="MQTT Topic" value={source.mqttTopic ?? ''} /><ReadonlyValue label="JSON Path" value={source.mqttValuePath ?? ''} /></>}
      {mode === 'rest' && <ReadonlyValue label="REST URL" value={source.dataUrl ?? ''} />}
      <ReadonlyValue label="對應群組列欄位" value={fields.join(', ')} />
      <ReadonlyValue label="實際更新方式" value={updateText(source, t)} />
    </div>
  );
}

function PostProcessMqtt({ source, fields }: { source: GroupDataSource; fields: string[] }) {
  const definition = getPostProcessorDefinition(source.postProcessId);
  if (!definition?.mqtt) return null;
  const inputs = fields.flatMap((field) => definition.mqtt?.inputsByOutput[field] ?? []);
  if (inputs.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border border-cyan-700/40 bg-cyan-950/20 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 font-bold text-cyan-200">即時覆寫</span>
        <span className="text-zinc-300">後處理：{definition.label}</span>
      </div>
      <ReadonlyValue label="MQTT 資料來源" value={sourceName(definition.mqtt.dataSourceId)} />
      <ReadonlyValue label="MQTT Topic" value={definition.mqtt.topic} />
      <ReadonlyValue label="JSON Path／輸入欄位" value={[...new Set(inputs)].join(', ')} />
      <ReadonlyValue label="處理規則" value={definition.description} />
      <ReadonlyValue label="實際更新方式" value="即時串流（MQTT operation/update）" />
    </div>
  );
}

export function WidgetDataBindingSettings({ w, onUpdate }: { w: WidgetDataBinding; onUpdate: (p: Partial<WidgetDataBinding>) => void }) {
  const { t } = useTranslation();
  const context = React.useContext(WidgetDataBindingContext);
  const groupSources = activeGroupSources(context?.group ?? null, context?.previewRow ?? null);
  const lineage = context ? describeWidgetDataLineage(context.widget, context.group, context.previewRow) : null;
  const fields = lineage?.fields.map((field) => field.name) ?? [];
  const inheritedSources = fields.length > 0 ? groupSources : [];
  const inheritedByMode: Record<Mode, GroupDataSource[]> = {
    sql: inheritedSources.filter((source) => !!source.sqlQuery),
    mqtt: inheritedSources.filter((source) => !!source.mqttTopic),
    rest: inheritedSources.filter((source) => !!source.dataUrl),
  };
  const postProcessSources = inheritedSources.filter((source) => {
    const definition = getPostProcessorDefinition(source.postProcessId);
    return fields.some((field) => (definition?.mqtt?.inputsByOutput[field]?.length ?? 0) > 0);
  });

  const ownSql = !!(w.dataSourceId || w.sqlQuery?.trim());
  const ownMqtt = !!(w.mqttDataSourceId || w.mqttTopic?.trim());
  const ownRest = !!w.dataUrl?.trim();
  const hasOwn = ownSql || ownMqtt || ownRest;
  const hasInherited = inheritedSources.length > 0;
  const initialMode: Mode = ownSql || inheritedByMode.sql.length > 0 ? 'sql' : ownMqtt || inheritedByMode.mqtt.length > 0 || postProcessSources.length > 0 ? 'mqtt' : 'rest';
  const bindingKey = `${(context?.widget as { id?: string } | undefined)?.id ?? ''}:${getRowSourceMetadata(context?.previewRow)?.sourceId ?? ''}`;
  const [modeChoice, setModeChoice] = React.useState<{ key: string; mode: Mode }>(() => ({ key: bindingKey, mode: initialMode }));
  const mode = modeChoice.key === bindingKey ? modeChoice.mode : initialMode;

  const policy = (w.freshnessPolicy ?? 'auto') as FreshnessPolicy;
  const fr = resolveFreshness(w);
  const showOwnEditor = hasOwn || !hasInherited;
  const editableValueField = Object.prototype.hasOwnProperty.call(w, 'valueField')
    ? String((w as WidgetDataBinding & { valueField?: string }).valueField ?? '')
    : null;
  const editableMqttProgressPath = Object.prototype.hasOwnProperty.call(w, 'mqttProgressPath')
    ? String((w as WidgetDataBinding & { mqttProgressPath?: string }).mqttProgressPath ?? '')
    : null;

  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-3 bg-zinc-900/50">
      {!hasOwn && !hasInherited && <div className="rounded border border-zinc-700 bg-zinc-950/50 px-2.5 py-2 text-[10px] text-zinc-400">未綁定／固定內容</div>}
      {context?.group && <div className={`text-[10px] ${context.error ? (context.stale ? 'text-amber-300' : 'text-red-300') : 'text-zinc-500'}`}>
        {context.error ? `${context.stale ? '本次更新失敗，保留上次資料' : '連線失敗'}：${context.error}` : context.loading ? '正在讀取群組資料…' : !context.previewRow ? '目前無資料（已保留綁定設定）' : '已自動使用目前樣板的真實資料列'}
      </div>}

      <div className="flex gap-1 bg-zinc-800 p-0.5 rounded-md">
        {(['sql', 'mqtt', 'rest'] as const).map((item) => {
          const active = item === 'sql' ? ownSql || inheritedByMode.sql.length > 0 : item === 'mqtt' ? ownMqtt || inheritedByMode.mqtt.length > 0 || postProcessSources.length > 0 : ownRest || inheritedByMode.rest.length > 0;
          return <button key={item} type="button" onClick={() => setModeChoice({ key: bindingKey, mode: item })} className={`flex-1 py-1 text-[10px] font-bold rounded uppercase transition-all ${mode === item ? 'bg-cyan-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>{item}{active ? ' •' : ''}</button>;
        })}
      </div>

      {mode === 'sql' && <div className="space-y-2.5">
        {showOwnEditor && <div className="space-y-2">{ownSql && <div className="text-[10px] font-bold text-emerald-300">元件自身綁定</div>}<DataSourcePicker dataSourceId={w.dataSourceId ?? ''} sqlQuery={w.sqlQuery ?? ''} onChangeDataSource={(id) => onUpdate(dataSourceSelectionPatch('sql', id))} onChangeSqlQuery={(sqlQuery) => onUpdate({ sqlQuery })} /></div>}
        {inheritedByMode.sql.map((source) => <InheritedSource key={source.id} source={source} mode="sql" fields={fields} />)}
        {!showOwnEditor && inheritedByMode.sql.length === 0 && <p className="text-[10px] text-zinc-500">未設定 SQL 綁定</p>}
      </div>}

      {mode === 'mqtt' && <div className="space-y-2.5">
        {showOwnEditor && <div className="space-y-2">{ownMqtt && <div className="text-[10px] font-bold text-emerald-300">元件自身綁定</div>}<DataSourceIdSelect kind="mqtt" value={w.mqttDataSourceId ?? ''} onChange={(id) => onUpdate(dataSourceSelectionPatch('mqtt', id))} /><Field label={t('dashboard.properties.mqttTopic')}><input value={w.mqttTopic ?? ''} onChange={(event) => onUpdate({ mqttTopic: event.target.value })} className={inputCls} placeholder="未設定" /></Field><Field label={t('dashboard.properties.mqttPath')}><input value={w.mqttValuePath ?? ''} onChange={(event) => onUpdate({ mqttValuePath: event.target.value })} className={inputCls} placeholder="未設定" /></Field>{editableMqttProgressPath !== null && <Field label="MQTT 進度 JSON Path"><input value={editableMqttProgressPath} onChange={(event) => onUpdate({ mqttProgressPath: event.target.value } as Partial<WidgetDataBinding>)} className={inputCls} placeholder="未設定" /></Field>}</div>}
        {inheritedByMode.mqtt.map((source) => <InheritedSource key={source.id} source={source} mode="mqtt" fields={fields} />)}
        {postProcessSources.map((source) => <PostProcessMqtt key={`post-${source.id}`} source={source} fields={fields} />)}
        {!showOwnEditor && inheritedByMode.mqtt.length === 0 && postProcessSources.length === 0 && <p className="text-[10px] text-zinc-500">未設定 MQTT 綁定</p>}
      </div>}

      {mode === 'rest' && <div className="space-y-2.5">
        {showOwnEditor && <div className="space-y-2">{ownRest && <div className="text-[10px] font-bold text-emerald-300">元件自身綁定</div>}<Field label={t('dashboard.properties.restUrl')}><input value={w.dataUrl ?? ''} onChange={(event) => onUpdate({ dataUrl: event.target.value })} className={inputCls} placeholder="未設定" /></Field></div>}
        {inheritedByMode.rest.map((source) => <InheritedSource key={source.id} source={source} mode="rest" fields={fields} />)}
        {!showOwnEditor && inheritedByMode.rest.length === 0 && <p className="text-[10px] text-zinc-500">未設定 REST 綁定</p>}
      </div>}

      {fields.length > 0 && <ReadonlyValue label="元件使用欄位" value={fields.join(', ')} />}
      {editableValueField !== null && <Field label="元件自身對應欄位">
        <input
          aria-label="元件自身對應欄位"
          value={editableValueField}
          onChange={(event) => onUpdate({ valueField: event.target.value } as Partial<WidgetDataBinding>)}
          className={inputCls}
        />
        {!editableValueField && hasInherited && <p className="text-[10px] text-zinc-500">未設定獨立欄位；目前使用上方群組列欄位。</p>}
      </Field>}
      {hasOwn && <Field label={t('dashboard.properties.freshness')}><select value={policy} onChange={(event) => onUpdate({ freshnessPolicy: event.target.value as FreshnessPolicy })} className={inputCls}>{FRESHNESS_POLICY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(`dashboard.properties.freshnessOpt.${option.value}`)}</option>)}</select><p className="text-zinc-500 text-[10px] leading-snug mt-1">{t(`dashboard.properties.freshnessHint.${policy}`)}<span className="block text-zinc-600 mt-0.5">{t('dashboard.properties.freshnessCurrent', { reason: t(`dashboard.properties.freshnessReason.${fr.reasonKey}`, fr.reasonParams) })}</span></p>{policy === 'interval' && <input type="number" min={1} value={w.refreshInterval || 15} onChange={(event) => onUpdate({ refreshInterval: +event.target.value })} className={`${inputCls} mt-1.5`} />}</Field>}
    </div>
  );
}
