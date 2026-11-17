import { SiteSelect } from '../../../components/SiteSelect';
import { Database, Radio } from 'lucide-react';
import {
  getDataSourcesForBinding,
  getDataSourceById,
  isDataSourceAllowedForBinding,
  type DataSourceBindingKind,
} from '../store/useDataSourceStore';

const inputCls = `w-full bg-surface-secondary border border-border-quaternary rounded-md px-2.5 py-1.5 text-text-primary text-body-xs
  focus:outline-none focus:border-border-theme focus:ring-1 focus:ring-border-theme-light transition-colors`;

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
      <label className="block text-text-quaternary text-body-xs mb-1 flex items-center gap-1">
        <Icon size={10} /> {kind === 'sql' ? 'SQL 資料來源' : 'MQTT 資料來源'}
      </label>
      <SiteSelect
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
      </SiteSelect>
      {invalid && (
        <p className="mt-1 text-caption-2 text-status-warning">
          目前綁定的「{invalidName ?? value}」不是此類型，請改選
          {kind === 'sql' ? ' SQL ' : ' MQTT '}
          資料來源（設定 → 資料來源可管理分類）。
        </p>
      )}
      {sources.length === 0 && (
        <p className="mt-1 text-caption-2 text-text-quaternary">
          尚無此類資料來源，請至設定 → 資料來源新增。
        </p>
      )}
    </div>
  );
}
