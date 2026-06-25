import { Database, Radio } from 'lucide-react';
import {
  getDataSourcesForBinding,
  getDataSourceById,
  isDataSourceAllowedForBinding,
  type DataSourceBindingKind,
} from '../store/useDataSourceStore';

const inputCls = `w-full bg-zinc-800/80 border border-zinc-700 rounded-md px-2.5 py-1.5 text-zinc-200 text-xs
  focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 transition-colors`;

interface Props {
  kind: DataSourceBindingKind;
  value: string;
  onChange: (id: string) => void;
  emptyLabel?: string;
}

export function DataSourceIdSelect({ kind, value, onChange, emptyLabel }: Props) {
  const sources = getDataSourcesForBinding(kind);
  const invalid =
    Boolean(value) && !isDataSourceAllowedForBinding(value, kind);
  const invalidName = invalid ? getDataSourceById(value)?.name : null;
  const Icon = kind === 'mqtt' ? Radio : Database;
  const placeholder =
    emptyLabel ??
    (kind === 'sql' ? '— 選擇 SQL 資料來源 —' : '— 選擇 MQTT 資料來源 —');

  return (
    <div>
      <label className="block text-zinc-500 text-xs mb-1 flex items-center gap-1">
        <Icon size={10} /> {kind === 'sql' ? 'SQL 資料來源' : 'MQTT 資料來源'}
      </label>
      <select
        value={invalid ? '' : value}
        onChange={e => onChange(e.target.value)}
        className={inputCls}
      >
        <option value="">{placeholder}</option>
        {sources.map(ds => (
          <option key={ds.id} value={ds.id}>
            {ds.name}
          </option>
        ))}
      </select>
      {invalid && (
        <p className="mt-1 text-[10px] text-amber-500/90 leading-relaxed">
          目前綁定的「{invalidName ?? value}」不是此類型，請改選
          {kind === 'sql' ? ' SQL ' : ' MQTT '}
          資料來源（設定 → 資料來源可管理分類）。
        </p>
      )}
      {sources.length === 0 && (
        <p className="mt-1 text-[10px] text-zinc-500">
          尚無此類資料來源，請至設定 → 資料來源新增。
        </p>
      )}
    </div>
  );
}
