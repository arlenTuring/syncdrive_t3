import React from 'react';
import type { WidgetDataBinding } from '../types';
import { DataSourcePicker } from './DataSourcePicker';
import { DataSourceIdSelect } from './DataSourceIdSelect';

const inputCls = `w-full bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-zinc-200 text-xs
  focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 transition-colors`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-zinc-500 text-[10px] uppercase font-bold tracking-tight">{label}</label>
      {children}
    </div>
  );
}

export function WidgetDataBindingSettings({
  w,
  onUpdate,
}: {
  w: WidgetDataBinding;
  onUpdate: (p: Partial<WidgetDataBinding>) => void;
}) {
  const [mode, setMode] = React.useState<'sql' | 'mqtt' | 'rest'>(
    w.mqttDataSourceId ? 'mqtt' : w.dataUrl ? 'rest' : 'sql',
  );

  React.useEffect(() => {
    setMode(w.mqttDataSourceId ? 'mqtt' : w.dataUrl ? 'rest' : 'sql');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.dataSourceId, w.mqttDataSourceId, w.dataUrl]);

  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-3 bg-zinc-900/50">
      <div className="flex gap-1 bg-zinc-800 p-0.5 rounded-md">
        {(['sql', 'mqtt', 'rest'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 py-1 text-[10px] font-bold rounded uppercase transition-all
              ${mode === m ? 'bg-cyan-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === 'sql' && (
        <DataSourcePicker
          dataSourceId={w.dataSourceId ?? ''}
          sqlQuery={w.sqlQuery ?? ''}
          onChangeDataSource={(id) => onUpdate({ dataSourceId: id, mqttDataSourceId: '', dataUrl: '' })}
          onChangeSqlQuery={(q) => onUpdate({ sqlQuery: q })}
        />
      )}

      {mode === 'mqtt' && (
        <div className="space-y-2">
          <DataSourceIdSelect
            kind="mqtt"
            value={w.mqttDataSourceId ?? ''}
            onChange={(id) => onUpdate({ mqttDataSourceId: id, dataSourceId: '', dataUrl: '' })}
          />
          <Field label="訂閱主題 (Topic)">
            <input
              value={w.mqttTopic ?? ''}
              onChange={(e) => onUpdate({ mqttTopic: e.target.value })}
              className={inputCls}
              placeholder="v1/vtms/+/operation/update"
            />
          </Field>
          <Field label="數值路徑 (JSON Path)">
            <input
              value={w.mqttValuePath ?? ''}
              onChange={(e) => onUpdate({ mqttValuePath: e.target.value })}
              className={inputCls}
              placeholder="route_progress"
            />
          </Field>
        </div>
      )}

      {mode === 'rest' && (
        <Field label="直接 REST URL">
          <input
            value={w.dataUrl ?? ''}
            onChange={(e) => onUpdate({ dataUrl: e.target.value, dataSourceId: '', mqttDataSourceId: '' })}
            className={inputCls}
            placeholder="https://api.example.com/data"
          />
        </Field>
      )}

      {(mode === 'sql' || mode === 'rest') && (
        <Field label="自動重新整理 (秒)">
          <input
            type="number"
            min={0}
            value={w.refreshInterval || 0}
            onChange={(e) => onUpdate({ refreshInterval: +e.target.value })}
            className={inputCls}
          />
        </Field>
      )}
    </div>
  );
}
