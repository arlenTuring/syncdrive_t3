import { useMemo } from 'react';
import type { CanvasElementProps, ChildWidget } from '../types';
import { useVariables } from '../VariableContext';
import { getDataSourceById } from '../store/useDataSourceStore';
import { describeWidgetDataLineage, type LineageSource } from '../utils/widgetDataLineage';

/**
 * 屬性面板最上方的「資料來源」卡：這個元件畫面上的值實際從哪裡來、現在是多少。
 *
 * 子畫布／樣板裡的元件常常自己沒有綁定，而是讀群組每一列的欄位（{eta_remain}）。原本
 * 面板只顯示元件自己的 SQL／MQTT 分頁，全部空白，看起來像沒接資料；這張卡把群組的
 * 來源、讀哪些欄位、哪些欄位會被即時資料覆寫、目前預覽列的值都列出來。
 */

const KIND_LABEL: Record<LineageSource['kind'], string> = { sql: 'SQL', rest: 'REST', mqtt: 'MQTT' };

function sourceName(id: string | undefined): string {
  if (!id) return '（未選資料來源）';
  const ds = getDataSourceById(id);
  return ds ? `${ds.name}（${id}）` : `找不到資料來源「${id}」`;
}

function SourceLine({ source }: { source: LineageSource }) {
  const firstLine = source.target.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  return (
    <li className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-1">
        <span className="rounded bg-zinc-700/80 px-1 text-[9px] font-bold text-zinc-100">{KIND_LABEL[source.kind]}</span>
        {source.label && <span className="text-zinc-300">{source.label}</span>}
        {source.kind !== 'rest' && <span className="text-zinc-400">{sourceName(source.dataSourceId)}</span>}
      </div>
      <code className="block break-all font-mono text-[9px] text-zinc-400" title={source.target}>
        {source.kind === 'sql' ? `${firstLine}${source.target.includes('\n') ? ' …' : ''}` : source.target}
      </code>
      {source.path && <div className="text-[9px] text-zinc-500">JSON 路徑：{source.path}</div>}
      {source.postProcessId && (
        <div className="text-[9px] text-zinc-500">後處理：{source.postProcessId}（依車端即時 MQTT 覆寫部分欄位）</div>
      )}
    </li>
  );
}

function formatValue(value: unknown): string {
  if (value === undefined) return '（沒有這個欄位）';
  if (value === null || value === '') return '（空）';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function WidgetDataLineageCard({
  widget,
  group,
}: {
  widget: ChildWidget;
  group: CanvasElementProps | null;
}) {
  const variables = useVariables();
  const lineage = useMemo(() => describeWidgetDataLineage(widget, group), [widget, group]);

  if (lineage.status === 'decorative') return null;
  if (lineage.status === 'label') {
    return (
      <div className="mb-4 rounded-lg border border-zinc-700/60 bg-zinc-900/40 p-3 text-[10px] leading-relaxed text-zinc-400">
        <span className="font-bold text-zinc-300">資料來源：</span>無（固定標題文字「{lineage.staticText}」）
      </div>
    );
  }

  const tone = lineage.problems.length > 0 || lineage.status === 'static'
    ? 'border-amber-600/50 bg-amber-950/30'
    : 'border-emerald-700/40 bg-emerald-950/20';

  return (
    <div className={`mb-4 space-y-2 rounded-lg border p-3 text-[10px] leading-relaxed text-zinc-300 ${tone}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-200">資料來源</div>

      {lineage.status === 'static' && (
        <p className="text-amber-300">
          沒有綁定任何資料來源，畫面上的字是寫死的
          {lineage.staticText ? <>：<span className="font-mono">「{lineage.staticText}」</span></> : null}
        </p>
      )}

      {lineage.own.length > 0 && (
        <div>
          <div className="text-zinc-400">元件自己的綁定</div>
          <ul className="mt-0.5 space-y-1.5">
            {lineage.own.map((source, index) => <SourceLine key={index} source={source} />)}
          </ul>
        </div>
      )}

      {lineage.group && (
        <div>
          <div className="text-zinc-400">
            讀群組「{lineage.group.label}」每一列的欄位，群組資料來自
          </div>
          {lineage.group.sources.length > 0 ? (
            <ul className="mt-0.5 space-y-1.5">
              {lineage.group.sources.map((source, index) => <SourceLine key={index} source={source} />)}
            </ul>
          ) : (
            <p className="text-amber-300">（群組沒有設定資料來源）</p>
          )}
        </div>
      )}

      {lineage.fields.length > 0 && lineage.group && (
        <div>
          <div className="text-zinc-400">讀的欄位與目前預覽列的值</div>
          <ul className="mt-0.5 space-y-1">
            {lineage.fields.map((field) => (
              <li key={field.name}>
                <span className="font-mono text-cyan-300">{`{${field.name}}`}</span>
                <span className="text-zinc-500"> ＝ </span>
                <span className="font-mono text-zinc-100">{formatValue(variables[field.name])}</span>
                {field.derivedFrom && <div className="text-[9px] text-zinc-500">執行時覆寫：{field.derivedFrom}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {lineage.problems.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-amber-300">
          {lineage.problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      )}
    </div>
  );
}
