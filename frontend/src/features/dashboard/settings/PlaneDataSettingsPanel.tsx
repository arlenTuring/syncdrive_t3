import { SiteSelect } from '../../../components/SiteSelect';
import { useState } from 'react';
import { Copy, Link2 } from 'lucide-react';
import type { DashboardPlane, PlaneDataSettings } from '../types';
import {
  getDataSourceTypeLabel,
  useDataSourceStore,
  type DataSourceConfig,
} from '../store/useDataSourceStore';
import { resolvePlaneSourceId } from '../context/PlaneDataSourceContext';
import {
  collectPlaneSourceRefs,
  planesUsingDefinition,
  withSourceSelection,
} from '../utils/planeDataSources';
import { systemAlert } from '../../../lib/systemDialog';
import { Button } from '../../../components/ui';

interface Props {
  plane: DashboardPlane;
  planes: DashboardPlane[];
  onChange: (settings: PlaneDataSettings) => void;
}

const selectCls = `w-full bg-surface-secondary border border-border-quaternary rounded-lg px-3 py-2 text-text-primary text-body-s
  focus:outline-none focus:border-border-theme focus:ring-1 focus:ring-border-theme-light transition-colors`;

/** 給新的專用定義取一個不撞號的 ID（只能英數、點、底線、連字號） */
function planeCopyId(sourceId: string, plane: DashboardPlane, existing: DataSourceConfig[]): string {
  const slug = plane.id.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40) || 'plane';
  let id = `${sourceId}--${slug}`.slice(0, 120);
  let n = 2;
  while (existing.some((ds) => ds.id === id)) id = `${sourceId}--${slug}-${n++}`.slice(0, 128);
  return id;
}

/**
 * 「資料設定」的本儀表板分頁：這張儀表板引用的每個來源，各自選要用哪一份連線定義。
 *
 * 這裡只改這張儀表板的選擇（存在伺服器 dashboard_planes.data_settings），不會動到其他儀表板。
 * 連線定義本身是共用的：要改連線內容又不想影響別張，就按「建立本儀表板專用連線」複製一份再改。
 */
export function PlaneDataSettingsPanel({ plane, planes, onChange }: Props) {
  const { dataSources, addDataSource } = useDataSourceStore();
  const [busy, setBusy] = useState<string | null>(null);
  const refs = collectPlaneSourceRefs(plane);
  const rows: Array<{ boundId: string; kind: 'sql' | 'mqtt' }> = [
    ...refs.sql.map((boundId) => ({ boundId, kind: 'sql' as const })),
    ...refs.mqtt.map((boundId) => ({ boundId, kind: 'mqtt' as const })),
  ];

  const optionsFor = (kind: 'sql' | 'mqtt') =>
    dataSources.filter((ds) => (kind === 'sql' ? ds.type === 'internal' : ds.type === 'mqtt'));

  async function makePlaneCopy(boundId: string, selected: DataSourceConfig) {
    const id = planeCopyId(selected.id, plane, dataSources);
    setBusy(boundId);
    try {
      const { createdAt: _createdAt, updatedAt: _updatedAt, ...definition } = selected;
      const saved = await addDataSource({
        ...definition,
        id,
        name: `${selected.name}（${plane.name} 專用）`,
      });
      onChange(withSourceSelection(plane.dataSettings, boundId, saved.id));
    } catch (e) {
      void systemAlert(`建立專用連線失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-surface-theme border border-border-theme-light rounded-lg px-4 py-3 text-body-xs text-text-theme-light">
        這裡的選擇只屬於「{plane.name}」，存在伺服器上：其他帳號或瀏覽器打開同一張儀表板會讀到同一份設定，
        改這張不會影響其他儀表板。連線定義本身是共用的，要改連線內容又不想影響別張，請先「建立本儀表板專用連線」。
      </div>
      {rows.map(({ boundId, kind }) => {
        const selectedId = resolvePlaneSourceId(plane.dataSettings, boundId);
        const selected = dataSources.find((ds) => ds.id === selectedId);
        const sharedWith = selected
          ? planesUsingDefinition(planes, selected.id).filter((p) => p.id !== plane.id)
          : [];
        const options = optionsFor(kind);
        return (
          <div key={`${kind}-${boundId}`} className="rounded-xl border border-border-quaternary bg-link-standard p-4 space-y-2">
            <div className="flex items-center gap-2 text-body-s">
              <Link2 size={14} className="text-text-quaternary" />
              <span className="text-text-secondary">元件引用的來源</span>
              <code className="text-body-xs text-text-tertiary">{boundId}</code>
              <span className="text-caption-2 px-1.5 py-0.5 rounded bg-surface-secondary text-text-quaternary border border-border-quaternary">
                {getDataSourceTypeLabel(kind === 'sql' ? 'internal' : 'mqtt')}
              </span>
              {boundId === 'default-internal' && <span className="text-body-xs text-text-quaternary">（也決定站內 REST 載入的後端）</span>}
              {boundId === 'default-mqtt' && <span className="text-body-xs text-text-quaternary">（也決定車隊與圖台即時資料）</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SiteSelect
                className={selectCls}
                value={selected ? selectedId : ''}
                onChange={(e) => onChange(withSourceSelection(plane.dataSettings, boundId, e.target.value))}
              >
                {!selected && <option value="">（找不到「{selectedId}」，請改選）</option>}
                {options.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    {ds.name}（{ds.id}）{ds.id === boundId ? '・元件原本的來源' : ''}
                  </option>
                ))}
              </SiteSelect>
              {selected && (
                <Button variant="outlined" className="shrink-0" leadingIcon={<Copy />} disabled={busy === boundId} onPress={() => makePlaneCopy(boundId, selected)} title="複製目前選的連線定義，只給這張儀表板用">建立本儀表板專用連線</Button>
              )}
            </div>
            {selected && sharedWith.length > 0 && (
              <p className="text-body-xs text-status-warning">
                「{selected.name}」也被 {sharedWith.map((p) => `「${p.name}」`).join('、')} 使用；
                在「連線定義（共用）」分頁修改它會一起影響這些儀表板。
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
