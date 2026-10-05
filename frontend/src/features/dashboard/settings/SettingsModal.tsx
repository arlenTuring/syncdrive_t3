import { useState } from 'react';
import { X, Database, Plus, Trash2, CheckCircle, AlertCircle, Loader, Edit2, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DashboardPlane, PlaneDataSettings } from '../types';
import { PlaneDataSettingsPanel } from './PlaneDataSettingsPanel';
import { planesUsingDefinition } from '../utils/planeDataSources';
import {
  useDataSourceStore,
  seedDashboardAll,
  getDataSourceTypeLabel,
  type DataSourceConfig,
  type DataSourceType,
} from '../store/useDataSourceStore';

interface Props {
  onClose: () => void;
  onClearAll: () => void;
  /** 目前開啟的儀表板：有給就是「資料設定」（本儀表板的來源選擇＋共用連線定義） */
  plane?: DashboardPlane | null;
  planes?: DashboardPlane[];
  onChangePlaneDataSettings?: (settings: PlaneDataSettings) => void;
}

type PingState = 'idle' | 'loading' | 'ok' | 'error';

const inputCls = `w-full bg-zinc-800/80 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200 text-sm
  focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 transition-colors`;

export function SettingsModal({ onClose, onClearAll, plane, planes = [], onChangePlaneDataSettings }: Props) {
  const { t } = useTranslation();
  const {
    dataSources, loading: dataSourcesLoading, error: dataSourcesError, legacySources,
    importLegacyDataSources, addDataSource, updateDataSource, deleteDataSource,
  } = useDataSourceStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [pingStates, setPingStates] = useState<Record<string, PingState>>({});
  const [activeTab, setActiveTab] = useState<'plane' | 'datasource' | 'general'>(plane ? 'plane' : 'datasource');
  const [seedState, setSeedState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');

  const dataSourceSections: {
    type: DataSourceType;
    title: string;
    hint: string;
  }[] = [
    {
      type: 'internal',
      title: t('dashboard.settings.sectionSqlTitle'),
      hint: t('dashboard.settings.sectionSqlHint'),
    },
    {
      type: 'mqtt',
      title: t('dashboard.settings.sectionMqttTitle'),
      hint: t('dashboard.settings.sectionMqttHint'),
    },
  ];

  async function pingDataSource(ds: DataSourceConfig) {
    if (ds.type !== 'internal') return;
    setPingStates(p => ({ ...p, [ds.id]: 'loading' }));
    try {
      const res = await fetch(`${ds.backendUrl}/syncdrive-api/datasource/ping`);
      const { ok } = await res.json();
      setPingStates(p => ({ ...p, [ds.id]: ok ? 'ok' : 'error' }));
    } catch {
      setPingStates(p => ({ ...p, [ds.id]: 'error' }));
    }
    setTimeout(() => setPingStates(p => ({ ...p, [ds.id]: 'idle' })), 4000);
  }

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 backdrop-blur-sm"
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-[680px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-4">
            {plane && (
              <span className="text-sm font-bold text-zinc-100 pr-2 border-r border-zinc-700 -mb-0">
                資料設定 · {plane.name}
              </span>
            )}
            {plane && onChangePlaneDataSettings && (
              <button onClick={() => setActiveTab('plane')} className={`text-sm font-semibold transition-colors pb-4 border-b-2 -mb-4 ${activeTab === 'plane' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>本儀表板</button>
            )}
            <button onClick={() => setActiveTab('datasource')} className={`text-sm font-semibold transition-colors pb-4 border-b-2 -mb-4 ${activeTab === 'datasource' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>{t('dashboard.settings.tabDatasource')}</button>
            <button onClick={() => setActiveTab('general')} className={`text-sm font-semibold transition-colors pb-4 border-b-2 -mb-4 ${activeTab === 'general' ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>{t('dashboard.settings.tabGeneral')}</button>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 transition-colors p-1">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {activeTab === 'plane' && plane && onChangePlaneDataSettings ? (
            <PlaneDataSettingsPanel plane={plane} planes={planes} onChange={onChangePlaneDataSettings} />
          ) : activeTab === 'datasource' ? (
            <>
              <div className="bg-purple-900/20 border border-purple-800/40 rounded-lg px-4 py-3 text-xs text-purple-300 leading-relaxed">
                {t('dashboard.settings.datasourceIntro')}
              </div>
              {dataSourcesLoading && <div className="text-xs text-zinc-400">正在讀取伺服器資料來源…</div>}
              {dataSourcesError && <div className="rounded border border-red-700/50 bg-red-950/30 p-2 text-xs text-red-300">讀取失敗：{dataSourcesError}</div>}
              {legacySources.length > 0 && (
                <div className="rounded border border-amber-700/50 bg-amber-950/20 p-3 text-xs text-amber-200">
                  偵測到這個瀏覽器的舊資料來源設定。伺服器同 ID 的設定不會被覆寫。
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={async () => {
                      try {
                        const conflicts = await importLegacyDataSources();
                        alert(conflicts.length ? `匯入完成：\n${conflicts.join('\n')}` : '舊資料來源已匯入伺服器');
                      } catch (e) {
                        alert(`匯入失敗：${e instanceof Error ? e.message : String(e)}`);
                      }
                    }}
                  >匯入舊設定</button>
                </div>
              )}

              {dataSourceSections.map(section => {
                const sectionSources = dataSources.filter(ds => ds.type === section.type);
                return (
                  <div key={section.type} className="space-y-2">
                    <div className="flex items-center gap-2 pt-1">
                      <h3 className="text-zinc-300 text-sm font-semibold">{section.title}</h3>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700">
                        {getDataSourceTypeLabel(section.type)}
                      </span>
                    </div>
                    <p className="text-zinc-500 text-xs leading-relaxed -mt-1">{section.hint}</p>
                    {sectionSources.length === 0 ? (
                      <div className="text-zinc-600 text-xs px-3 py-2 border border-dashed border-zinc-700 rounded-lg">
                        {t('dashboard.settings.emptySection')}
                      </div>
                    ) : (
                      sectionSources.map(ds => (
                        <DataSourceCard
                          key={ds.id}
                          ds={ds}
                          pingState={pingStates[ds.id] ?? 'idle'}
                          isEditing={editingId === ds.id}
                          onEdit={() => setEditingId(editingId === ds.id ? null : ds.id)}
                          onSave={async (patch) => {
                            try { await updateDataSource(ds.id, patch); setEditingId(null); }
                            catch (e) { alert(`儲存失敗：${e instanceof Error ? e.message : String(e)}`); }
                          }}
                          onDelete={async () => {
                            try { await deleteDataSource(ds.id); }
                            catch (e) { alert(`刪除失敗：${e instanceof Error ? e.message : String(e)}`); }
                          }}
                          onPing={() => pingDataSource(ds)}
                          usedBy={planesUsingDefinition(planes, ds.id).map((p) => p.name)}
                        />
                      ))
                    )}
                  </div>
                );
              })}

              {showAddForm
                ? <AddDataSourceForm
                    onAdd={async (cfg) => {
                      try { await addDataSource(cfg); setShowAddForm(false); }
                      catch (e) { alert(`新增失敗：${e instanceof Error ? e.message : String(e)}`); }
                    }}
                    onCancel={() => setShowAddForm(false)}
                  />
                : (
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="w-full py-3 border-2 border-dashed border-zinc-700 rounded-xl text-zinc-500 text-sm
                               hover:border-purple-600 hover:text-purple-400 transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus size={16} /> {t('dashboard.settings.addDatasource')}
                  </button>
                )
              }
            </>
          ) : (
            <div className="space-y-6">
              <div className="p-4 border border-zinc-700/60 bg-zinc-800/30 rounded-xl">
                <div className="text-zinc-300 text-sm font-semibold">{t('dashboard.settings.restoreExamplesTitle')}</div>
                <p className="text-zinc-500 text-xs mt-1 leading-relaxed">
                  {t('dashboard.settings.restoreExamplesBody')}
                </p>
              </div>
              <div>
                <h3 className="text-zinc-200 text-sm font-semibold mb-2">{t('dashboard.settings.demoDataTitle')}</h3>
                <div className="p-4 border border-cyan-900/30 bg-cyan-950/10 rounded-xl flex items-center justify-between gap-4">
                  <div>
                    <div className="text-cyan-300 text-sm font-bold">{t('dashboard.settings.seedTitle')}</div>
                    <div className="text-zinc-500 text-xs mt-1">{t('dashboard.settings.seedHint')}</div>
                  </div>
                  <button
                    type="button"
                    disabled={seedState === 'loading'}
                    onClick={async () => {
                      setSeedState('loading');
                      try {
                        await seedDashboardAll();
                        setSeedState('ok');
                        alert(t('dashboard.settings.seedOkAlert'));
                      } catch (e: unknown) {
                        setSeedState('error');
                        alert(e instanceof Error ? e.message : t('dashboard.settings.seedFailAlert'));
                      }
                      setTimeout(() => setSeedState('idle'), 3000);
                    }}
                    className="px-4 py-2 rounded-lg bg-cyan-600/20 border border-cyan-600/40 text-cyan-300 text-xs font-bold uppercase hover:bg-cyan-600 hover:text-white transition-all whitespace-nowrap disabled:opacity-50"
                  >
                    {seedState === 'loading'
                      ? t('dashboard.settings.seedLoading')
                      : seedState === 'ok'
                        ? t('dashboard.settings.seedDone')
                        : seedState === 'error'
                          ? t('dashboard.settings.seedError')
                          : t('dashboard.settings.seedIdle')}
                  </button>
                </div>
              </div>
              <div>
                <h3 className="text-zinc-200 text-sm font-semibold mb-2">{t('dashboard.settings.dangerZone')}</h3>
                <div className="p-4 border border-red-900/30 bg-red-950/10 rounded-xl space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-red-400 text-sm font-bold">{t('dashboard.settings.clearAllTitle')}</div>
                      <div className="text-zinc-500 text-xs mt-1">{t('dashboard.settings.clearAllHint')}</div>
                    </div>
                    <button 
                      onClick={() => { if(confirm(t('dashboard.settings.clearAllConfirm'))) { onClearAll(); onClose(); } }}
                      className="px-4 py-2 rounded-lg bg-red-600/20 border border-red-600/40 text-red-400 text-xs font-bold uppercase hover:bg-red-600 hover:text-white transition-all whitespace-nowrap"
                    >
                      {t('dashboard.settings.clearAllAction')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-zinc-800 flex justify-end">
          <button onClick={onClose}
            className="px-5 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm
                       hover:border-zinc-500 transition-colors">
            {t('dashboard.settings.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

function DataSourceCard({ ds, pingState, isEditing, onEdit, onSave, onDelete, onPing, usedBy = [] }: {
  ds: DataSourceConfig;
  pingState: PingState;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (patch: Partial<DataSourceConfig>) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onPing: () => void;
  /** 實際用到這份連線的儀表板（直接綁定或經資料設定對應） */
  usedBy?: string[];
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: ds.name,
    backendUrl: ds.backendUrl,
    description: ds.description,
    mqttTopic: ds.mqttTopic ?? '',
  });
  const isDefault = ds.id === 'default-internal' || ds.id === 'default-mqtt';

  const pingIcon = {
    idle: null,
    loading: <Loader size={13} className="animate-spin text-yellow-400" />,
    ok: <CheckCircle size={13} className="text-green-400" />,
    error: <AlertCircle size={13} className="text-red-400" />,
  }[pingState];

  const pingLabel = {
    idle: t('dashboard.settings.pingIdle'),
    loading: t('dashboard.settings.pingLoading'),
    ok: t('dashboard.settings.pingOk'),
    error: t('dashboard.settings.pingError'),
  }[pingState];

  return (
    <div className="border border-zinc-700/60 rounded-xl bg-zinc-800/30 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-8 h-8 rounded-lg bg-purple-900/40 border border-purple-800/40 flex items-center justify-center flex-shrink-0">
          <Database size={14} className="text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-zinc-200 text-sm font-medium truncate">{ds.name}</span>
            {isDefault && <span className="text-xs px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-400 border border-purple-800/40">{t('dashboard.settings.defaultBadge')}</span>}
            <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-400">
              {ds.type === 'internal' ? 'PostgreSQL' : ds.type === 'mqtt' ? 'Socket.IO' : 'REST'}
            </span>
          </div>
          <div className="text-zinc-500 text-xs mt-0.5 truncate">
            {ds.type === 'internal' ? ds.backendUrl : ''} {ds.description && `· ${ds.description}`}
          </div>
          <div className="text-[11px] mt-0.5 text-zinc-500">
            {usedBy.length > 0 ? `使用中的儀表板：${usedBy.join('、')}` : '目前沒有儀表板使用'}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {ds.type === 'internal' && (
            <button onClick={onPing}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border border-zinc-600
                         text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors">
              {pingIcon ?? <CheckCircle size={12} />} {pingLabel}
            </button>
          )}
          {!isDefault && (
            <>
              <button onClick={onEdit} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors">
                <Edit2 size={13} />
              </button>
              <button onClick={onDelete} className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-900/20 transition-colors">
                <Trash2 size={13} />
              </button>
            </>
          )}
          {isDefault && (
            <button onClick={onEdit} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors">
              <Edit2 size={13} />
            </button>
          )}
        </div>
      </div>

      {isEditing && (
        <div className="border-t border-zinc-700/60 px-4 py-4 space-y-3 bg-zinc-800/50">
          {usedBy.length > 1 && (
            <div className="rounded-lg border border-amber-700/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
              這是共用連線，修改會同時影響 {usedBy.map((n) => `「${n}」`).join('、')}。
              只想改目前這張儀表板，請到「本儀表板」分頁按「建立本儀表板專用連線」。
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-500 text-xs mb-1">{t('dashboard.settings.name')}</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-zinc-500 text-xs mb-1">{t('dashboard.settings.backendUrl')}</label>
              <input value={form.backendUrl} onChange={e => setForm(f => ({ ...f, backendUrl: e.target.value }))} className={inputCls} placeholder="http://localhost:3000" />
            </div>
          </div>
          {ds.type === 'mqtt' && (
            <div>
              <label className="block text-zinc-500 text-xs mb-1">{t('dashboard.settings.mqttTopic')}</label>
              <input
                value={form.mqttTopic ?? ''}
                onChange={e => setForm(f => ({ ...f, mqttTopic: e.target.value }))}
                className={inputCls}
                placeholder="v1/vtms/+/telemetry/update"
              />
            </div>
          )}
          <div>
            <label className="block text-zinc-500 text-xs mb-1">{t('dashboard.settings.description')}</label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={inputCls} />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => onSave(form)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-purple-600 text-white text-xs hover:bg-purple-500 transition-colors">
              <Save size={12} /> {t('dashboard.settings.save')}
            </button>
            <button onClick={onEdit}
              className="px-4 py-1.5 rounded-lg border border-zinc-600 text-zinc-400 text-xs hover:text-zinc-200 transition-colors">
              {t('dashboard.settings.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddDataSourceForm({ onAdd, onCancel }: {
  onAdd: (cfg: Omit<DataSourceConfig, 'id' | 'createdAt'>) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: '',
    type: 'internal' as DataSourceType,
    backendUrl: '',
    description: '',
    mqttTopic: 'v1/vtms/+/telemetry/update',
  });

  return (
    <div className="border-2 border-purple-700/40 rounded-xl bg-purple-900/10 p-4 space-y-3">
      <h3 className="text-purple-300 text-sm font-medium">{t('dashboard.settings.addFormTitle')}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-zinc-500 text-xs mb-1">{t('dashboard.settings.nameRequired')}</label>
          <input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className={inputCls}
            placeholder={form.type === 'mqtt' ? t('dashboard.settings.namePlaceholderMqtt') : t('dashboard.settings.namePlaceholderSql')}
          />
        </div>
        <div>
          <label className="block text-zinc-500 text-xs mb-1">{t('dashboard.settings.typeRequired')}</label>
          <select
            value={form.type}
            onChange={e => setForm(f => ({ ...f, type: e.target.value as DataSourceType }))}
            className={inputCls}
          >
            <option value="internal">{t('dashboard.settings.typeSql')}</option>
            <option value="mqtt">{t('dashboard.settings.typeMqtt')}</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-zinc-500 text-xs mb-1">{t('dashboard.settings.backendUrlOptional')}</label>
        <input value={form.backendUrl} onChange={e => setForm(f => ({ ...f, backendUrl: e.target.value }))} className={inputCls} placeholder={t('dashboard.settings.backendUrlPlaceholder')} />
      </div>
      {form.type === 'mqtt' && (
        <div>
          <label className="block text-zinc-500 text-xs mb-1">{t('dashboard.settings.mqttTopic')}</label>
          <input
            value={form.mqttTopic}
            onChange={e => setForm(f => ({ ...f, mqttTopic: e.target.value }))}
            className={inputCls}
            placeholder="v1/vtms/+/telemetry/update"
          />
        </div>
      )}
      <div>
        <label className="block text-zinc-500 text-xs mb-1">{t('dashboard.settings.description')}</label>
        <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={inputCls} />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => {
            if (!form.name) return;
            const { mqttTopic, ...rest } = form;
            onAdd(
              rest.type === 'mqtt'
                ? { ...rest, mqttTopic: mqttTopic || undefined }
                : rest,
            );
          }}
          disabled={!form.name}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 text-white text-xs hover:bg-purple-500 disabled:opacity-40 transition-colors"
        >
          <Plus size={12} /> {t('dashboard.settings.add')}
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-zinc-600 text-zinc-400 text-xs hover:text-zinc-200 transition-colors">
          {t('dashboard.settings.cancel')}
        </button>
      </div>
    </div>
  );
}
